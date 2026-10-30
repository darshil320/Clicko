import type {
  AdminCityList,
  AdminCreateStaffBody,
  AdminCreateStaffResponse,
  AdminGrantBody,
  AdminResetPasswordResponse,
  AdminStaffRow,
  StaffGrant,
  StaffProfile,
} from '@clickco/contracts';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { SQL } from '../../../infra/db/db.module';
import { TokenService } from '../../auth/token.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { CityScope } from '../access/roles';
import type {
  AuditContext,
  StaffAccessPort,
  StaffGrantRecord,
  StaffPrincipal,
} from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { LoginStore } from '../auth/login-store';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import { temporaryPasswordExpiry } from '../auth/password-policy';
import { type StaffRecord, StaffRepository, type Tx } from './staff.repository';

const STAFF_NOT_FOUND = { code: 'STAFF_NOT_FOUND', message: 'Staff member not found' };

const grantState = (g: StaffGrantRecord) => ({ grant_id: g.id, role: g.role, city_id: g.cityId });

/**
 * Staff accounts and their role grants (ADR-0025 D2/D3/D5): the per-request principal for
 * StaffGuard, the signed-in profile, and SUPER_ADMIN management. Every change writes its audit row
 * in the same transaction; deactivating or resetting TOTP ends every session of that person.
 */
@Injectable()
export class StaffService implements StaffAccessPort {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LoginStore) private readonly logins: LoginStore,
  ) {}

  async activePrincipal(staffId: string): Promise<StaffPrincipal | null> {
    const staff = await this.repo.findById(this.sql, staffId);
    if (!staff?.isActive) return null;
    const grants = await this.repo.grantsFor(this.sql, [staff.id]);
    return {
      id: staff.id,
      email: staff.email,
      fullName: staff.fullName,
      grants: grants.get(staff.id) ?? [],
      sessionsValidAfter: staff.sessionsValidAfter,
    };
  }

  async profile(staffId: string): Promise<StaffProfile> {
    const staff = await this.repo.findById(this.sql, staffId);
    if (!staff) throw new NotFoundException(STAFF_NOT_FOUND);
    const [row] = await this.rows([staff]);
    if (!row) throw new NotFoundException(STAFF_NOT_FOUND);
    return { id: row.id, email: row.email, fullName: row.fullName, grants: row.grants };
  }

  /** The caller's grant cities, or every city with an all-cities grant (the panel's pickers). */
  cities(scope: CityScope): Promise<AdminCityList> {
    return this.serviceability.cities(scope === 'ALL' ? null : scope);
  }

  async page(
    after: { readonly email: string; readonly id: string } | undefined,
    limit: number,
  ): Promise<AdminStaffRow[]> {
    return this.rows(await this.repo.page(this.sql, after, limit));
  }

  /**
   * A SUPER_ADMIN creates an account; the temporary password is returned once, never stored, and
   * stops working after 72 hours (ADR-0026 D7).
   */
  async create(ctx: AuditContext, body: AdminCreateStaffBody): Promise<AdminCreateStaffResponse> {
    await this.assertCities(body.grants.map((g) => g.cityId));
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const temporaryUntil = temporaryPasswordExpiry(this.clock());
    const staff = await this.sql.begin(async (tx) => {
      const created = await this.repo.insert(tx, {
        email: body.email,
        fullName: body.fullName,
        passwordHash,
        password: { temporaryUntil },
      });
      if (!created) {
        throw new ConflictException({
          code: 'STAFF_EMAIL_TAKEN',
          message: 'A staff account with this email already exists',
        });
      }
      const grants: StaffGrantRecord[] = [];
      for (const g of uniqueGrants(body.grants)) {
        grants.push(await this.addGrant(tx, created.id, g, ctx.actor?.id ?? null));
      }
      await this.audit.record(tx, ctx, {
        action: 'staff.create',
        entityKind: 'staff_user',
        entityId: created.id,
        before: null,
        after: {
          email: created.email,
          full_name: created.fullName,
          grants: grants.map(grantState),
          temporary_password_expires_at: temporaryUntil.toISOString(),
        },
      });
      return created;
    });
    const [row] = await this.rows([staff]);
    if (!row) throw new Error('staff.create: the new account vanished');
    return { staff: row, temporaryPassword };
  }

  async grant(ctx: AuditContext, staffId: string, body: AdminGrantBody): Promise<AdminStaffRow> {
    await this.assertCities([body.cityId]);
    await this.sql.begin(async (tx) => {
      await this.lockStaff(tx, staffId);
      const grant = await this.addGrant(tx, staffId, body, ctx.actor?.id ?? null);
      await this.audit.record(tx, ctx, {
        action: 'staff.grant',
        entityKind: 'staff_user',
        entityId: staffId,
        before: null,
        after: grantState(grant),
      });
    });
    return this.row(staffId);
  }

  /** A SUPER_ADMIN cannot drop their own SUPER_ADMIN grant (ADR-0025 D5). */
  async revokeGrant(ctx: AuditContext, staffId: string, grantId: string): Promise<AdminStaffRow> {
    await this.sql.begin(async (tx) => {
      await this.lockStaff(tx, staffId);
      const grant = await this.repo.findGrant(tx, staffId, grantId);
      if (!grant) {
        throw new NotFoundException({ code: 'GRANT_NOT_FOUND', message: 'Grant not found' });
      }
      if (staffId === ctx.actor?.id && grant.role === 'SUPER_ADMIN') {
        throw new ConflictException({
          code: 'CANNOT_DROP_OWN_SUPER_ADMIN',
          message: 'You cannot remove your own super admin role',
        });
      }
      if (grant.role === 'SUPER_ADMIN') await this.keepOneSuperAdmin(tx, staffId);
      await this.repo.deleteGrant(tx, grantId);
      await this.audit.record(tx, ctx, {
        action: 'staff.revoke_grant',
        entityKind: 'staff_user',
        entityId: staffId,
        before: grantState(grant),
        after: null,
      });
    });
    return this.row(staffId);
  }

  /** Ends every session at once. A SUPER_ADMIN cannot deactivate themselves. */
  async deactivate(ctx: AuditContext, staffId: string): Promise<AdminStaffRow> {
    if (staffId === ctx.actor?.id) {
      throw new ConflictException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
      });
    }
    await this.sql.begin(async (tx) => {
      const staff = await this.lockStaff(tx, staffId);
      const grants = (await this.repo.grantsFor(tx, [staffId])).get(staffId) ?? [];
      if (grants.some((g) => g.role === 'SUPER_ADMIN')) await this.keepOneSuperAdmin(tx, staffId);
      await this.repo.deactivate(tx, staffId);
      await this.repo.endSessions(tx, staffId, this.clock());
      await this.audit.record(tx, ctx, {
        action: 'staff.deactivate',
        entityKind: 'staff_user',
        entityId: staffId,
        before: { is_active: staff.isActive },
        after: { is_active: false },
      });
      // Inside the transaction: if the sessions cannot be revoked, nothing changes.
      await this.tokens.revokeAll({ kind: 'STAFF', id: staffId });
    });
    return this.row(staffId);
  }

  /** The next sign-in enrols a new authenticator; current sessions end. */
  async resetTotp(ctx: AuditContext, staffId: string): Promise<AdminStaffRow> {
    await this.sql.begin(async (tx) => {
      const staff = await this.lockStaff(tx, staffId);
      await this.repo.clearTotp(tx, staffId);
      await this.repo.endSessions(tx, staffId, this.clock());
      await this.audit.record(tx, ctx, {
        action: 'staff.reset_totp',
        entityKind: 'staff_user',
        entityId: staffId,
        before: { totp_enrolled: staff.totpSecret !== null },
        after: { totp_enrolled: false },
      });
      await this.tokens.revokeAll({ kind: 'STAFF', id: staffId });
    });
    return this.row(staffId);
  }

  /**
   * ADR-0026 D7: a new temporary password for someone who lost theirs — shown once, valid 72
   * hours, replaced at their next sign-in. Every session of theirs ends at once, and the failed
   * sign-in count on their email is cleared so they can use it straight away. Never the
   * caller's own (they use "Change password"), never a deactivated account.
   */
  async resetPassword(ctx: AuditContext, staffId: string): Promise<AdminResetPasswordResponse> {
    if (staffId === ctx.actor?.id) {
      throw new ConflictException({
        code: 'CANNOT_RESET_OWN_PASSWORD',
        message: 'Use “Change password” in your account menu to change your own password',
      });
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const temporaryUntil = temporaryPasswordExpiry(this.clock());
    const email = await this.sql.begin(async (tx) => {
      const staff = await this.lockStaff(tx, staffId);
      if (!staff.isActive) {
        throw new ConflictException({
          code: 'STAFF_INACTIVE',
          message: 'This account is deactivated, so it cannot sign in with any password',
        });
      }
      await this.repo.setPassword(tx, staffId, passwordHash, { temporaryUntil });
      await this.repo.endSessions(tx, staffId, this.clock());
      await this.audit.record(tx, ctx, {
        action: 'staff.reset_password',
        entityKind: 'staff_user',
        entityId: staffId,
        // Never the password: only that one was issued, and until when it works.
        before: {
          must_change_password: staff.mustChangePassword,
          temp_password_expires_at: staff.tempPasswordExpiresAt?.toISOString() ?? null,
        },
        after: {
          must_change_password: true,
          temp_password_expires_at: temporaryUntil.toISOString(),
          sessions_revoked: true,
        },
      });
      // Inside the transaction: if the sessions cannot be revoked, nothing changes.
      await this.tokens.revokeAll({ kind: 'STAFF', id: staffId });
      return staff.email;
    });
    // Best effort: a lockout left in place only delays the first sign-in by 15 minutes.
    await this.logins.clearEmail(email).catch(() => undefined);
    return {
      staff: await this.row(staffId),
      temporaryPassword,
      expiresAt: temporaryUntil.toISOString(),
    };
  }

  private async row(staffId: string): Promise<AdminStaffRow> {
    const staff = await this.repo.findById(this.sql, staffId);
    const [row] = staff ? await this.rows([staff]) : [];
    if (!row) throw new NotFoundException(STAFF_NOT_FOUND);
    return row;
  }

  private async rows(staff: readonly StaffRecord[]): Promise<AdminStaffRow[]> {
    const grants = await this.repo.grantsFor(
      this.sql,
      staff.map((s) => s.id),
    );
    const cityIds = [...grants.values()].flat().flatMap((g) => (g.cityId ? [g.cityId] : []));
    const names = await this.serviceability.cityNames(cityIds);
    return staff.map((s) => ({
      id: s.id,
      email: s.email,
      fullName: s.fullName,
      isActive: s.isActive,
      totpEnrolled: s.totpSecret !== null,
      lastLoginAt: s.lastLoginAt?.toISOString() ?? null,
      temporaryPasswordExpiresAt: s.mustChangePassword
        ? (s.tempPasswordExpiresAt?.toISOString() ?? null)
        : null,
      grants: (grants.get(s.id) ?? []).map(
        (g): StaffGrant => ({
          id: g.id,
          role: g.role,
          cityId: g.cityId,
          cityName: g.cityId ? (names.get(g.cityId) ?? null) : null,
        }),
      ),
    }));
  }

  /** Refuses a change that would leave no active SUPER_ADMIN. */
  private async keepOneSuperAdmin(tx: Tx, losingId: string): Promise<void> {
    if ((await this.repo.otherActiveSuperAdmins(tx, losingId)) === 0) {
      throw new ConflictException({
        code: 'LAST_SUPER_ADMIN',
        message: 'At least one active super admin must remain',
      });
    }
  }

  private async lockStaff(tx: Tx, staffId: string): Promise<StaffRecord> {
    const staff = await this.repo.lock(tx, staffId);
    if (!staff) throw new NotFoundException(STAFF_NOT_FOUND);
    return staff;
  }

  private async addGrant(
    tx: Tx,
    staffId: string,
    g: AdminGrantBody,
    grantedBy: string | null,
  ): Promise<StaffGrantRecord> {
    if (g.role === 'SUPER_ADMIN' && g.cityId !== null) {
      // roles.ts treats every SUPER_ADMIN grant as all cities: never store a misleading city.
      throw new UnprocessableEntityException({
        code: 'SUPER_ADMIN_IS_GLOBAL',
        message: 'A super admin covers every city — leave the city empty',
      });
    }
    const result = await this.repo.insertGrant(tx, { staffId, ...g, grantedBy });
    if (result === 'DUPLICATE') {
      throw new ConflictException({
        code: 'GRANT_EXISTS',
        message: 'This role is already granted',
      });
    }
    if (result === 'NO_CITY') throw cityNotFound();
    return result;
  }

  private async assertCities(cityIds: readonly (string | null)[]): Promise<void> {
    const wanted = [...new Set(cityIds.filter((c): c is string => c !== null))];
    const names = await this.serviceability.cityNames(wanted);
    if (wanted.some((id) => !names.has(id))) throw cityNotFound();
  }
}

const cityNotFound = () =>
  new UnprocessableEntityException({ code: 'CITY_NOT_FOUND', message: 'Unknown city' });

/** The same role + city twice in one request is one grant. */
function uniqueGrants(grants: AdminCreateStaffBody['grants']): AdminCreateStaffBody['grants'] {
  const seen = new Set<string>();
  return grants.filter((g) => {
    const key = `${g.role}:${g.cityId ?? '*'}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
