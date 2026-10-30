import type { StaffChangePasswordBody, TokenPair } from '@clickco/contracts';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { SQL } from '../../../infra/db/db.module';
import { TokenService } from '../../auth/token.service';
import type { AuditActor, AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { type StaffRecord, StaffRepository } from '../staff/staff.repository';
import { LoginStore, STAFF_LOGIN_POLICY } from './login-store';
import { hashPassword, verifyPassword } from './password';
import { assertNewPassword } from './password-policy';
import { SecretBox } from './secret-box';
import { verifyTotp } from './totp';

/**
 * Wrong answers are 422, never 401: the person is signed in, and a 401 would end their session
 * in the panel (the SDK reads a 401 as "session over").
 */
const WRONG_PASSWORD = {
  code: 'CURRENT_PASSWORD_WRONG',
  message: 'Your current password is not right',
};
const WRONG_CODE = {
  code: 'TOTP_INVALID',
  message: 'That code is not right. Try the current one.',
};
const NO_AUTHENTICATOR = {
  code: 'TOTP_NOT_ENROLLED',
  message: 'Set up your authenticator first: sign out, then sign in again.',
};

const tooMany = () =>
  new HttpException(
    {
      code: 'RATE_LIMITED',
      message: 'Too many wrong attempts. Try again in 15 minutes.',
      details: { retryAfterSeconds: STAFF_LOGIN_POLICY.failureWindowMs / 1000 },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

const actorOf = (s: StaffRecord): AuditActor => ({ kind: 'STAFF', id: s.id, email: s.email });

/**
 * ADR-0026 D7 — a signed-in staff member changes their own password: the current password, a
 * new one within the policy, and a fresh authenticator code. The same lockouts as sign-in apply
 * (5 wrong passwords per email or 20 per IP in 15 min; 10 wrong codes per account; a code works
 * once). Every session of the person ends — this one included — and a new one is returned.
 */
@Injectable()
export class StaffPasswordService {
  private readonly logger = new Logger(StaffPasswordService.name);
  private readonly box: SecretBox;

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) env: Env,
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(LoginStore) private readonly store: LoginStore,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(env.STAFF_TOTP_KEY);
  }

  async change(
    caller: StaffCaller,
    body: StaffChangePasswordBody,
    ctx: AuditContext,
  ): Promise<TokenPair> {
    const staff = await this.repo.findById(this.sql, caller.id);
    // StaffGuard has just checked the account is active; losing it now is a race.
    if (!staff?.isActive) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'This account is not active. Please sign in again.',
      });
    }
    await this.checkCurrentPassword(staff, body.currentPassword, ctx);
    await assertNewPassword(body.newPassword, staff);
    await this.checkCode(staff, body.code, ctx);

    const newHash = await hashPassword(body.newPassword);
    await this.sql.begin(async (tx) => {
      const locked = await this.repo.lock(tx, staff.id);
      if (!locked || locked.passwordHash !== staff.passwordHash) {
        throw new ConflictException({
          code: 'PASSWORD_CHANGED_ELSEWHERE',
          message: 'Your password was changed a moment ago. Sign in again.',
        });
      }
      const now = this.clock();
      await this.repo.setPassword(tx, staff.id, newHash, { chosenAt: now });
      await this.repo.endSessions(tx, staff.id, now);
      await this.audit.record(tx, ctx, {
        action: 'staff.password_changed',
        actor: actorOf(staff),
        entityKind: 'staff_user',
        entityId: staff.id,
        before: { must_change_password: locked.mustChangePassword },
        after: { must_change_password: false, via: 'self_service', sessions_revoked: true },
      });
      // Inside the transaction: if the sessions cannot be revoked, the password stays as it was.
      await this.tokens.revokeAll({ kind: 'STAFF', id: staff.id });
    });
    await Promise.all([
      this.store.clearEmail(staff.email).catch(() => undefined),
      this.store.clearTotpFailures(staff.id).catch(() => undefined),
    ]);
    return this.tokens.issue({ kind: 'STAFF', id: staff.id }, null);
  }

  /** Counted against the email and IP before the check, released when right (as sign-in). */
  private async checkCurrentPassword(
    staff: StaffRecord,
    password: string,
    ctx: AuditContext,
  ): Promise<void> {
    const counts = await this.guarded(() => this.store.reserve(staff.email, ctx.ip));
    if (
      counts.email > STAFF_LOGIN_POLICY.maxFailuresPerEmail ||
      counts.ip > STAFF_LOGIN_POLICY.maxFailuresPerIp
    ) {
      await this.failed(staff, ctx, 'LOCKED');
      throw tooMany();
    }
    if (!(await verifyPassword(password, staff.passwordHash))) {
      await this.failed(staff, ctx, 'BAD_PASSWORD');
      throw new UnprocessableEntityException(WRONG_PASSWORD);
    }
    await this.guarded(() => this.store.release(staff.email, ctx.ip));
  }

  /** A fresh code from the enrolled authenticator, used once (the sign-in replay guard). */
  private async checkCode(staff: StaffRecord, code: string, ctx: AuditContext): Promise<void> {
    if (!staff.totpSecret) throw new UnprocessableEntityException(NO_AUTHENTICATOR);
    const failures = await this.guarded(() => this.store.totpFailures(staff.id));
    if (failures >= STAFF_LOGIN_POLICY.maxTotpFailuresPerStaff) {
      await this.failed(staff, ctx, 'LOCKED_TOTP');
      throw tooMany();
    }
    const step = verifyTotp(this.box.open(staff.totpSecret, staff.id), code, this.clock());
    if (step === null || !(await this.guarded(() => this.store.claimStep(staff.id, step)))) {
      await this.guarded(() => this.store.recordTotpFailure(staff.id));
      await this.failed(staff, ctx, step === null ? 'BAD_TOTP' : 'TOTP_REUSED');
      throw new UnprocessableEntityException(WRONG_CODE);
    }
  }

  private async failed(staff: StaffRecord, ctx: AuditContext, reason: string): Promise<void> {
    await this.audit.recordAlone(ctx, {
      action: 'staff.password_change_failed',
      actor: actorOf(staff),
      entityKind: 'staff_user',
      entityId: staff.id,
      after: { reason },
    });
  }

  /** The lockout counters live in Redis: without it, fail closed with a clear 503. */
  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Staff password store unavailable (${error instanceof Error ? error.name : 'error'})`,
      );
      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Changing passwords is unavailable right now. Please try again shortly.',
      });
    }
  }
}
