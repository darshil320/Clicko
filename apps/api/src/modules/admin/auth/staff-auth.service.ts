import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type {
  StaffLoginBody,
  StaffLoginChallenge,
  StaffSessionResponse,
  StaffTotpBody,
  TokenPair,
} from '@clickco/contracts';
import { staffPasswordProblem } from '@clickco/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { SQL } from '../../../infra/db/db.module';
import { TokenService } from '../../auth/token.service';
import type { AuditActor, AuditContext } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { type StaffRecord, StaffRepository, type Tx } from '../staff/staff.repository';
import { StaffService } from '../staff/staff.service';
import { devAccountRefused } from './dev-accounts';
import { LoginStore, passwordFingerprint, STAFF_LOGIN_POLICY } from './login-store';
import { hashPassword, verifyPassword } from './password';
import {
  assertNewPassword,
  TEMPORARY_PASSWORD_EXPIRED,
  temporaryPasswordExpired,
} from './password-policy';
import { SecretBox } from './secret-box';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp';

/** One answer for unknown email, wrong password and inactive account (no enumeration). */
const BAD_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Email or password is wrong' };
const BAD_CODE = { code: 'TOTP_INVALID', message: 'That code is not right. Try the current one.' };
const CHALLENGE_GONE = {
  code: 'CHALLENGE_INVALID',
  message: 'This sign-in has expired. Enter your password again.',
};
const CHANGE_REQUIRED = {
  code: 'PASSWORD_CHANGE_REQUIRED',
  message: 'Choose a new password to finish signing in.',
};

const staffActor = (s: StaffRecord): AuditActor => ({ kind: 'STAFF', id: s.id, email: s.email });

const locked = () =>
  new HttpException(
    {
      code: 'RATE_LIMITED',
      message: 'Too many failed sign-ins. Try again in 15 minutes.',
      details: { retryAfterSeconds: STAFF_LOGIN_POLICY.failureWindowMs / 1000 },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Staff sign-in (ADR-0025 D2): email + password → a 5-minute challenge in Redis bound to the
 * staff id → TOTP (enrolled at first sign-in) → a STAFF session (12 h refresh, fixed). Lockout:
 * 5 failed passwords per email and network / 20 per network (IPv6 per /64) per 15 min, then 429,
 * counted before the password is checked; per email alone only slows and alerts (audit M2); 5 wrong codes burn the challenge, and 10 per account per 15 min stop
 * new challenges (so a known password cannot brute-force the code); a code works once.
 * Sign-ins, failures and enrolment go to the audit log.
 *
 * ADR-0026 D7: a temporary password works for 72 hours; signing in with one makes the code step
 * carry a new password, saved in the same transaction that starts the session. A challenge is
 * bound to the password it was earned with, so a reset in between voids it.
 */
@Injectable()
export class StaffAuthService implements OnModuleInit {
  private readonly logger = new Logger(StaffAuthService.name);
  private readonly box: SecretBox;
  private readonly nodeEnv: Env['NODE_ENV'];
  /** Verified against when the email is unknown, so timing does not reveal accounts. */
  private decoy: Promise<string> | null = null;

  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) env: Env,
    @Inject(StaffRepository) private readonly repo: StaffRepository,
    @Inject(StaffService) private readonly staff: StaffService,
    @Inject(LoginStore) private readonly store: LoginStore,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(env.STAFF_TOTP_KEY);
    this.nodeEnv = env.NODE_ENV;
  }

  /** The decoy hash exists before the first request, so no request pays for building it. */
  async onModuleInit(): Promise<void> {
    this.decoy = hashPassword(randomUUID());
    await this.decoy;
  }

  async login(body: StaffLoginBody, ctx: AuditContext): Promise<StaffLoginChallenge> {
    const counts = await this.guarded(() => this.store.reserve(body.email, ctx.ip));
    // First, so the crossing attempt is alerted even when it is also hard-locked.
    await this.emailSignal(body.email, counts.email, ctx);
    // Audit M2: the hard lock is per (email, network) and per network — never per email alone,
    // which let anyone lock the real owner out from anywhere.
    if (
      counts.emailIp > STAFF_LOGIN_POLICY.maxFailuresPerEmailIp ||
      counts.ip > STAFF_LOGIN_POLICY.maxFailuresPerIp
    ) {
      await this.failed(ctx, body.email, null, 'LOCKED');
      throw locked();
    }
    const staff = await this.repo.findByEmail(this.sql, body.email);
    const passwordOk = await verifyPassword(
      body.password,
      staff?.passwordHash ?? (await this.decoyHash()),
    );
    if (!staff || !passwordOk || !staff.isActive) {
      // The reserved attempt stays counted: it was a failure.
      await this.failed(ctx, body.email, staff?.id ?? null, 'BAD_CREDENTIALS');
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    // Clients audit L3: a development account (public password) never signs in when deployed —
    // the same answer as a wrong password.
    if (
      devAccountRefused(
        this.nodeEnv,
        staff.email,
        this.nodeEnv === 'development' || this.nodeEnv === 'test'
          ? false
          : await this.repo.createdByDevSeed(this.sql, staff.id),
      )
    ) {
      await this.failed(ctx, body.email, staff.id, 'DEV_ACCOUNT');
      throw new UnauthorizedException(BAD_CREDENTIALS);
    }
    if (temporaryPasswordExpired(staff, this.clock())) {
      // The password was right (no enumeration: only its holder learns it expired). The attempt
      // stays counted, so an expired password cannot be replayed without limit.
      await this.failed(ctx, body.email, staff.id, 'TEMP_PASSWORD_EXPIRED');
      throw new UnauthorizedException(TEMPORARY_PASSWORD_EXPIRED);
    }
    await this.guarded(() => this.store.release(body.email, ctx.ip));
    const totpFailures = await this.guarded(() => this.store.totpFailures(staff.id));
    if (totpFailures >= STAFF_LOGIN_POLICY.maxTotpFailuresPerStaff) {
      await this.failed(ctx, body.email, staff.id, 'LOCKED_TOTP');
      throw locked();
    }
    return this.challenge(staff);
  }

  async verify(body: StaffTotpBody, ctx: AuditContext): Promise<StaffSessionResponse> {
    const challenge = await this.guarded(() => this.store.getChallenge(body.challengeId));
    if (!challenge) throw new UnauthorizedException(CHALLENGE_GONE);
    const staff = await this.repo.findById(this.sql, challenge.staffId);
    const sealed = challenge.step === 'ENROL_TOTP' ? challenge.pendingSecret : staff?.totpSecret;
    if (
      !staff?.isActive ||
      !sealed ||
      passwordFingerprint(staff.passwordHash) !== challenge.passwordFingerprint
    ) {
      await this.store.deleteChallenge(body.challengeId);
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    // ADR-0026 D7, before any attempt is counted: a password that breaks the (cheap, syntactic)
    // policy is a typo to fix, not a guess at the code.
    const newPassword = await this.newPasswordFor(staff, body.challengeId, body.newPassword);
    // Counted before the code is checked: concurrent guesses cannot exceed the five.
    const attempt = await this.guarded(() => this.store.attemptChallenge(body.challengeId));
    if (attempt === 0 || attempt > STAFF_LOGIN_POLICY.maxTotpAttempts) {
      await this.store.deleteChallenge(body.challengeId);
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    const step = verifyTotp(this.box.open(sealed, staff.id), body.code, this.clock());
    if (step === null || !(await this.guarded(() => this.store.claimStep(staff.id, step)))) {
      return this.wrongCode(
        body.challengeId,
        attempt,
        staff,
        ctx,
        step === null ? 'BAD_TOTP' : 'TOTP_REUSED',
      );
    }
    // Only after a right code (one scrypt per proven second factor): not the temporary password.
    if (newPassword !== null) await assertNewPassword(newPassword, staff);
    if (!(await this.store.deleteChallenge(body.challengeId))) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    // Hashed outside the transaction: scrypt is slow and must not hold a row lock.
    const newHash = newPassword === null ? null : await hashPassword(newPassword);
    const pair = await this.sql.begin(async (tx) => {
      // Security review M1: under the row lock, the account must still be active and hold the
      // password this challenge was earned with — a reset or deactivation in between wins. The
      // session is issued under the same lock, so a reset that follows revokes it too.
      const locked = await this.repo.lock(tx, staff.id);
      if (
        !locked?.isActive ||
        passwordFingerprint(locked.passwordHash) !== challenge.passwordFingerprint
      ) {
        throw new UnauthorizedException(CHALLENGE_GONE);
      }
      if (challenge.step === 'ENROL_TOTP') {
        if (!(await this.repo.setTotpSecret(tx, staff.id, sealed))) {
          throw new UnauthorizedException(CHALLENGE_GONE);
        }
        await this.audit.record(tx, ctx, {
          action: 'staff.totp_enrolled',
          actor: staffActor(staff),
          entityKind: 'staff_user',
          entityId: staff.id,
          before: { totp_enrolled: false },
          after: { totp_enrolled: true },
        });
      }
      if (newHash !== null) await this.replaceTemporaryPassword(tx, locked, newHash, ctx);
      await this.repo.markLogin(tx, staff.id, this.clock());
      await this.audit.record(tx, ctx, {
        action: 'staff.login',
        actor: staffActor(staff),
        entityKind: 'staff_user',
        entityId: staff.id,
        after: {
          enrolled_totp: challenge.step === 'ENROL_TOTP',
          password_changed: newHash !== null,
        },
      });
      return this.tokens.issue({ kind: 'STAFF', id: staff.id }, null);
    });
    await Promise.all([
      this.store.clearEmail(staff.email).catch(() => undefined),
      this.store.clearTotpFailures(staff.id).catch(() => undefined),
    ]);
    return { ...pair, staff: await this.staff.profile(staff.id) };
  }

  /**
   * The password to save with this sign-in: null for a chosen password; for a temporary one, the
   * new password the person typed — refused (422, the challenge kept) when missing or against
   * the policy, and the challenge burnt (401) when the temporary password has expired.
   */
  private async newPasswordFor(
    staff: StaffRecord,
    challengeId: string,
    newPassword: string | undefined,
  ): Promise<string | null> {
    if (!staff.mustChangePassword) return null;
    if (temporaryPasswordExpired(staff, this.clock())) {
      await this.store.deleteChallenge(challengeId);
      throw new UnauthorizedException(TEMPORARY_PASSWORD_EXPIRED);
    }
    if (newPassword === undefined) throw new UnprocessableEntityException(CHANGE_REQUIRED);
    const problem = staffPasswordProblem(newPassword, { email: staff.email });
    if (problem)
      throw new UnprocessableEntityException({ code: 'PASSWORD_REJECTED', message: problem });
    return newPassword;
  }

  /**
   * Saves the chosen password in the session's transaction (the caller holds the row lock and has
   * checked the challenge's password is still the stored one), and ends any other session.
   */
  private async replaceTemporaryPassword(
    tx: Tx,
    locked: StaffRecord,
    newHash: string,
    ctx: AuditContext,
  ): Promise<void> {
    const staff = locked;
    if (!locked.mustChangePassword) throw new UnauthorizedException(CHALLENGE_GONE);
    const now = this.clock();
    await this.repo.setPassword(tx, staff.id, newHash, { chosenAt: now });
    await this.repo.endSessions(tx, staff.id, now);
    await this.audit.record(tx, ctx, {
      action: 'staff.password_changed',
      actor: staffActor(staff),
      entityKind: 'staff_user',
      entityId: staff.id,
      before: {
        must_change_password: true,
        temp_password_expires_at: locked.tempPasswordExpiresAt?.toISOString() ?? null,
      },
      after: { must_change_password: false, via: 'first_sign_in' },
    });
    await this.tokens.revokeAll({ kind: 'STAFF', id: staff.id });
  }

  /** Rotates a staff session (12 h from sign-in, never extended); an inactive account loses all. */
  async refresh(refreshToken: string, ctx: AuditContext): Promise<TokenPair> {
    const { subject, ...pair } = await this.tokens.refresh(refreshToken, 'STAFF');
    const staff = await this.repo.findById(this.sql, subject.id);
    if (!staff?.isActive) {
      await this.tokens.revokeAll(subject);
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'This account is not active. Please sign in again.',
      });
    }
    await this.audit.recordAlone(ctx, {
      action: 'staff.refresh',
      actor: staffActor(staff),
      entityKind: 'staff_user',
      entityId: staff.id,
    });
    return pair;
  }

  /** Always succeeds; the refresh token stops working at once. */
  async logout(refreshToken: string, ctx: AuditContext): Promise<void> {
    const subject = await this.tokens.revoke(refreshToken);
    if (subject?.kind !== 'STAFF') return;
    const staff = await this.repo.findById(this.sql, subject.id);
    await this.audit.recordAlone(ctx, {
      action: 'staff.logout',
      actor: { kind: 'STAFF', id: subject.id, email: staff?.email ?? null },
      entityKind: 'staff_user',
      entityId: subject.id,
    });
  }

  private async challenge(staff: StaffRecord): Promise<StaffLoginChallenge> {
    const id = randomUUID();
    const expiresAt = new Date(this.clock().getTime() + STAFF_LOGIN_POLICY.challengeTtlMs);
    const bound = {
      staffId: staff.id,
      mustChangePassword: staff.mustChangePassword,
      passwordFingerprint: passwordFingerprint(staff.passwordHash),
    };
    if (staff.totpSecret) {
      await this.guarded(() =>
        this.store.saveChallenge(id, { ...bound, step: 'TOTP', pendingSecret: null }),
      );
      return {
        challengeId: id,
        step: 'TOTP',
        enrolment: null,
        mustChangePassword: staff.mustChangePassword,
        expiresAt: expiresAt.toISOString(),
      };
    }
    const secret = newTotpSecret();
    const base32 = base32Encode(secret);
    await this.guarded(() =>
      this.store.saveChallenge(id, {
        ...bound,
        step: 'ENROL_TOTP',
        pendingSecret: this.box.seal(secret, staff.id),
      }),
    );
    return {
      challengeId: id,
      step: 'ENROL_TOTP',
      enrolment: { secret: base32, otpauthUri: otpauthUri(base32, staff.email) },
      mustChangePassword: staff.mustChangePassword,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async wrongCode(
    challengeId: string,
    attempt: number,
    staff: StaffRecord,
    ctx: AuditContext,
    reason: 'BAD_TOTP' | 'TOTP_REUSED',
  ): Promise<never> {
    await this.guarded(() => this.store.recordTotpFailure(staff.id));
    await this.failed(ctx, staff.email, staff.id, reason);
    if (attempt >= STAFF_LOGIN_POLICY.maxTotpAttempts) {
      await this.store.deleteChallenge(challengeId);
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    throw new UnauthorizedException(BAD_CODE);
  }

  /**
   * Audit M2: many failures for one email across networks are a signal — each further attempt
   * waits a little longer (250 ms doubling, at most 4 s; the password still works, and the code
   * step stays limited per account), and the first crossing in a window is audited and alerted.
   */
  private async emailSignal(email: string, failures: number, ctx: AuditContext): Promise<void> {
    const over = failures - STAFF_LOGIN_POLICY.emailSignalThreshold;
    if (over <= 0) return;
    if (over === 1) {
      this.logger.warn('[OPS-ALERT staff-login] many failed sign-ins for one staff email');
      await this.audit.recordAlone(ctx, {
        action: 'staff.login_suspicious',
        actor: { kind: 'STAFF', id: null, email },
        entityKind: 'staff_user',
        entityId: null,
        after: {
          signal: 'MANY_FAILURES_FOR_EMAIL',
          failures_in_window: failures,
          window_minutes: STAFF_LOGIN_POLICY.failureWindowMs / 60_000,
        },
      });
    }
    await this.delay(
      Math.min(
        STAFF_LOGIN_POLICY.emailDelayBaseMs * 2 ** (over - 1),
        STAFF_LOGIN_POLICY.emailDelayMaxMs,
      ),
    );
  }

  /** A request-path pause (not scheduled work); a field so tests can replace it. */
  private delay: (ms: number) => Promise<unknown> = (ms) => sleep(ms);

  /** `staff.login_failed`, with the typed email even when no account matched. */
  private async failed(
    ctx: AuditContext,
    email: string,
    staffId: string | null,
    reason: string,
  ): Promise<void> {
    await this.audit.recordAlone(ctx, {
      action: 'staff.login_failed',
      actor: { kind: 'STAFF', id: null, email },
      entityKind: 'staff_user',
      entityId: staffId,
      after: { reason },
    });
  }

  private decoyHash(): Promise<string> {
    this.decoy ??= hashPassword(randomUUID());
    return this.decoy;
  }

  /** Sign-in state lives in Redis: without it, fail closed with a clear 503. */
  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Staff sign-in store unavailable (${error instanceof Error ? error.name : 'error'})`,
      );
      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Sign-in is unavailable right now. Please try again shortly.',
      });
    }
  }
}
