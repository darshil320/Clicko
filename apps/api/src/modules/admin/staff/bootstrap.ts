import { AdminCreateStaffBody, type StaffRole } from '@clickco/contracts';
import type postgres from 'postgres';
import { AuditRepository } from '../audit/audit.repository';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import { SecretBox } from '../auth/secret-box';
import { StaffRepository } from './staff.repository';

export interface BootstrapStaffInput {
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  /** Required for CITY_MANAGER; null = every city. */
  readonly cityId: string | null;
  /** Development seed only: a known password. Otherwise a temporary one is generated. */
  readonly password?: string;
  /** Development seed only: a pre-enrolled TOTP secret (raw bytes), sealed with `totpKey`. */
  readonly totp?: { readonly secret: Buffer; readonly totpKey: string };
  readonly via: 'cli' | 'dev-seed' | 'test';
}

export type BootstrapResult =
  | { readonly outcome: 'CREATED'; readonly staffId: string; readonly password: string }
  | { readonly outcome: 'EXISTS'; readonly staffId: string };

/**
 * The first SUPER_ADMIN (and the development seed) without the panel (ADR-0025 D2): validated
 * with the same contract as POST /admin/staff, one transaction, audited as SYSTEM `staff.create`.
 * An email that already exists is left untouched.
 */
export async function createStaffAccount(
  sql: postgres.Sql,
  input: BootstrapStaffInput,
  now: Date,
): Promise<BootstrapResult> {
  const body = AdminCreateStaffBody.parse({
    email: input.email,
    fullName: input.fullName,
    grants: [{ role: input.role, cityId: input.cityId }],
  });
  if (input.role === 'SUPER_ADMIN' && input.cityId !== null) {
    throw new Error('A SUPER_ADMIN covers every city: give no city id');
  }
  const staff = new StaffRepository();
  const existing = await staff.findByEmail(sql, body.email);
  if (existing) return { outcome: 'EXISTS', staffId: existing.id };
  const password = input.password ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(password);
  return sql.begin(async (tx) => {
    const created = await staff.insert(tx, {
      email: body.email,
      fullName: body.fullName,
      passwordHash,
    });
    if (!created) throw new Error(`A staff account with this email already exists`);
    const grant = await staff.insertGrant(tx, {
      staffId: created.id,
      role: input.role,
      cityId: input.cityId,
      grantedBy: null,
    });
    if (grant === 'NO_CITY') throw new Error('Unknown city id');
    if (grant === 'DUPLICATE') throw new Error('Duplicate grant');
    if (input.totp) {
      const sealed = new SecretBox(input.totp.totpKey).seal(input.totp.secret, created.id);
      await staff.setTotpSecret(tx, created.id, sealed);
    }
    await new AuditRepository().insert(tx, {
      actorKind: 'SYSTEM',
      actorId: null,
      actorEmail: null,
      action: 'staff.create',
      entityKind: 'staff_user',
      entityId: created.id,
      before: null,
      after: {
        email: created.email,
        full_name: created.fullName,
        grants: [{ grant_id: grant.id, role: grant.role, city_id: grant.cityId }],
        via: input.via,
      },
      ip: null,
      userAgent: null,
      requestId: null,
      occurredAt: now,
    });
    return { outcome: 'CREATED' as const, staffId: created.id, password };
  });
}
