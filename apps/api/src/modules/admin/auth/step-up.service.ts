import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { SQL } from '../../../infra/db/db.module';
import type { AuditContext } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { StaffRepository } from '../staff/staff.repository';
import { LoginStore, STAFF_LOGIN_POLICY } from './login-store';
import { SecretBox } from './secret-box';
import { verifyTotp } from './totp';

/** What the audit row and the publish record say the step-up was. */
export const STEP_UP_METHOD = 'TOTP';

const CODE_INVALID = {
  code: 'STEP_UP_CODE_INVALID',
  message: 'That code is not right. Enter the current code from your authenticator app.',
};
const CODE_USED = {
  code: 'STEP_UP_CODE_USED',
  message: 'That code was already used. Wait for the next one and try again.',
};

/**
 * Step-up authentication for a high-risk action (ADR-0026 D4: publishing prices). The request
 * itself carries a fresh authenticator code, checked against the caller's own TOTP secret:
 * - a code works once — the per-staff replay guard is shared with sign-in, so the code that just
 *   signed someone in cannot also publish;
 * - every attempt counts against the same per-account limit as sign-in (10 per 15 minutes),
 *   reserved before the code is checked, then 429; a right code clears it; every failure is
 *   audited (`staff.step_up_failed`);
 * - a wrong code is a 422 with the reason, never a 401 (the session itself is fine).
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);
  private readonly box: SecretBox;

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) env: Env,
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(LoginStore) private readonly store: LoginStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(env.STAFF_TOTP_KEY);
  }

  /** Resolves when `code` is a fresh, unused code of `staffId`'s authenticator; throws otherwise. */
  async verify(staffId: string, code: string, ctx: AuditContext, purpose: string): Promise<void> {
    // Counted BEFORE the code is checked (atomic INCR), so parallel guesses cannot all slip
    // under the limit; a correct code clears the count, as a successful sign-in does.
    await this.guarded(() => this.store.recordTotpFailure(staffId));
    const attempts = await this.guarded(() => this.store.totpFailures(staffId));
    if (attempts > STAFF_LOGIN_POLICY.maxTotpFailuresPerStaff) {
      await this.failed(ctx, staffId, purpose, 'LOCKED');
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Too many wrong codes. Try again in 15 minutes.',
          details: { retryAfterSeconds: STAFF_LOGIN_POLICY.failureWindowMs / 1000 },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const staff = await this.repo.findById(this.sql, staffId);
    if (!staff?.isActive || !staff.totpSecret) {
      throw new ForbiddenException({
        code: 'STEP_UP_UNAVAILABLE',
        message: 'Set up your authenticator app (sign in again) before doing this',
      });
    }
    const step = verifyTotp(this.box.open(staff.totpSecret, staff.id), code, this.clock());
    if (step === null) return this.wrong(ctx, staffId, purpose, 'BAD_TOTP', CODE_INVALID);
    if (!(await this.guarded(() => this.store.claimStep(staff.id, step)))) {
      return this.wrong(ctx, staffId, purpose, 'TOTP_REUSED', CODE_USED);
    }
    await this.store.clearTotpFailures(staff.id).catch(() => undefined);
  }

  private async wrong(
    ctx: AuditContext,
    staffId: string,
    purpose: string,
    reason: string,
    body: { readonly code: string; readonly message: string },
  ): Promise<never> {
    await this.failed(ctx, staffId, purpose, reason);
    throw new UnprocessableEntityException(body);
  }

  private failed(ctx: AuditContext, staffId: string, purpose: string, reason: string) {
    return this.audit.recordAlone(ctx, {
      action: 'staff.step_up_failed',
      entityKind: 'staff_user',
      entityId: staffId,
      after: { purpose, reason },
    });
  }

  /** The replay guard and counters live in Redis: without it, fail closed with a clear 503. */
  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Step-up store unavailable (${error instanceof Error ? error.name : 'error'})`,
      );
      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Code checks are unavailable right now. Please try again shortly.',
      });
    }
  }
}
