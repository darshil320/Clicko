import { randomUUID } from 'node:crypto';
import type {
  StaffLoginBody,
  StaffLoginChallenge,
  StaffSessionResponse,
  StaffTotpBody,
  TokenPair,
} from '@clickco/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../../common/clock';
import { ENV, type Env } from '../../../config/env';
import { SQL } from '../../../infra/db/db.module';
import { TokenService } from '../../auth/token.service';
import type { AuditActor, AuditContext } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { type StaffRecord, StaffRepository } from '../staff/staff.repository';
import { StaffService } from '../staff/staff.service';
import { LoginStore, STAFF_LOGIN_POLICY } from './login-store';
import { hashPassword, verifyPassword } from './password';
import { SecretBox } from './secret-box';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp';

/** One answer for unknown email, wrong password and inactive account (no enumeration). */
const BAD_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Email or password is wrong' };
const BAD_CODE = { code: 'TOTP_INVALID', message: 'That code is not right. Try the current one.' };
const CHALLENGE_GONE = {
  code: 'CHALLENGE_INVALID',
  message: 'This sign-in has expired. Enter your password again.',
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
 * 5 failed passwords per email / 20 per IP (IPv6 per /64) per 15 min, then 429, counted before
 * the password is checked; 5 wrong codes burn the challenge, and 10 per account per 15 min stop
 * new challenges (so a known password cannot brute-force the code); a code works once.
 * Sign-ins, failures and enrolment go to the audit log.
 */
@Injectable()
export class StaffAuthService implements OnModuleInit {
  private readonly logger = new Logger(StaffAuthService.name);
  private readonly box: SecretBox;
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
  }

  /** The decoy hash exists before the first request, so no request pays for building it. */
  async onModuleInit(): Promise<void> {
    this.decoy = hashPassword(randomUUID());
    await this.decoy;
  }

  async login(body: StaffLoginBody, ctx: AuditContext): Promise<StaffLoginChallenge> {
    const counts = await this.guarded(() => this.store.reserve(body.email, ctx.ip));
    if (
      counts.email > STAFF_LOGIN_POLICY.maxFailuresPerEmail ||
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
    // Counted before the code is checked: concurrent guesses cannot exceed the five.
    const attempt = await this.guarded(() => this.store.attemptChallenge(body.challengeId));
    if (attempt === 0 || attempt > STAFF_LOGIN_POLICY.maxTotpAttempts) {
      await this.store.deleteChallenge(body.challengeId);
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    const staff = await this.repo.findById(this.sql, challenge.staffId);
    const sealed = challenge.step === 'ENROL_TOTP' ? challenge.pendingSecret : staff?.totpSecret;
    if (!staff?.isActive || !sealed) {
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
    if (!(await this.store.deleteChallenge(body.challengeId))) {
      throw new UnauthorizedException(CHALLENGE_GONE);
    }
    await this.sql.begin(async (tx) => {
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
      await this.repo.markLogin(tx, staff.id, this.clock());
      await this.audit.record(tx, ctx, {
        action: 'staff.login',
        actor: staffActor(staff),
        entityKind: 'staff_user',
        entityId: staff.id,
        after: { enrolled_totp: challenge.step === 'ENROL_TOTP' },
      });
    });
    await Promise.all([
      this.store.clearEmail(staff.email).catch(() => undefined),
      this.store.clearTotpFailures(staff.id).catch(() => undefined),
    ]);
    const pair = await this.tokens.issue({ kind: 'STAFF', id: staff.id }, null);
    return { ...pair, staff: await this.staff.profile(staff.id) };
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
    if (staff.totpSecret) {
      await this.guarded(() =>
        this.store.saveChallenge(id, { staffId: staff.id, step: 'TOTP', pendingSecret: null }),
      );
      return { challengeId: id, step: 'TOTP', enrolment: null, expiresAt: expiresAt.toISOString() };
    }
    const secret = newTotpSecret();
    const base32 = base32Encode(secret);
    await this.guarded(() =>
      this.store.saveChallenge(id, {
        staffId: staff.id,
        step: 'ENROL_TOTP',
        pendingSecret: this.box.seal(secret, staff.id),
      }),
    );
    return {
      challengeId: id,
      step: 'ENROL_TOTP',
      enrolment: { secret: base32, otpauthUri: otpauthUri(base32, staff.email) },
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
