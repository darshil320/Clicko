import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { OtpPurpose, RequestOtpResponse } from '@clickco/contracts';
import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { OtpDelivery, type OtpDeliveryQueue } from './otp-delivery';
import { OTP_LIMITS, type OtpLimits, type SmsReservation } from './otp-limits';
import { OTP_PEPPER } from './otp-tokens';
import { OTP_REPOSITORY, type OtpRepository } from './repositories/otp.repository';

export { OTP_PEPPER } from './otp-tokens';

export const OTP_POLICY = {
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
  resendCooldownMs: 30 * 1000,
  maxPerPhonePerHour: 5,
  maxPerPhonePerDay: 10,
  maxPerIpPerHour: 20,
} as const;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** One message for every verify failure, so responses never reveal which check failed. */
const INVALID_CODE = { code: 'OTP_INVALID', message: 'The code is invalid or has expired' };

const SMS_UNAVAILABLE = {
  code: 'SMS_UNAVAILABLE',
  message: 'We could not send the code right now. Please try again shortly.',
};

const phoneLockedToday = () =>
  rateLimited('Too many wrong codes for this number. Try again tomorrow.', 86400);

function rateLimited(message: string, retryAfterSeconds: number): HttpException {
  return new HttpException(
    { code: 'RATE_LIMITED', message, details: { retryAfterSeconds } },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(OTP_REPOSITORY) private readonly repo: OtpRepository,
    @Inject(OtpDelivery) private readonly delivery: OtpDeliveryQueue,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OTP_PEPPER) private readonly pepper: string,
    @Inject(OTP_LIMITS) private readonly limits: OtpLimits,
  ) {}

  /**
   * Stores the challenge and queues the SMS (ADR-0012 D8) — the gateway is never on the request
   * path. `deliver = false` (a PRO_LOGIN for a number that is not an active photographer) queues
   * an identical decoy job that sends nothing, so response, timing and limits match a real one.
   */
  async request(
    phone: string,
    purpose: OtpPurpose,
    ip: string | null,
    deliver = true,
  ): Promise<RequestOtpResponse> {
    const now = this.clock();
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(now.getTime() + OTP_POLICY.ttlMs);
    // Audit L2: a phone locked for wrong codes gets no new code until the window ends.
    if ((await this.guardedLimits(() => this.limits.verifyFailures(phone))) >= this.maxFailures) {
      throw phoneLockedToday();
    }

    await this.repo.withLocks(phone, ip, async (repo) => {
      await this.enforceLimits(repo, phone, purpose, ip, now);
      // Audit M5, last: only a request every other limit allowed spends the SMS budget.
      this.assertSmsBudget(await this.guardedLimits(() => this.limits.reserveSms(phone)));
      await repo.supersedeActive(phone, purpose, now);
      await repo.insert({
        id,
        phone,
        codeHash: this.hash(id, phone, code),
        purpose,
        attempts: 0,
        maxAttempts: OTP_POLICY.maxAttempts,
        consumedAt: null,
        expiresAt,
        ip,
        createdAt: now,
      });
    });

    try {
      await this.delivery.enqueue({ challengeId: id, phone, code, deliver, expiresAt });
    } catch (error) {
      // The queue (Redis) is down — the same for every number, so this reveals nothing. The row
      // stays and counts toward rate limits. Name only: errors can carry the request.
      this.logger.error(
        `OTP SMS could not be queued (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      throw new ServiceUnavailableException(SMS_UNAVAILABLE);
    }

    return {
      challengeId: id,
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: OTP_POLICY.resendCooldownMs / 1000,
    };
  }

  /** Resolves when the code is correct; throws 401 otherwise. Single use. */
  async verify(
    challengeId: string,
    phone: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<void> {
    const now = this.clock();
    // Audit L2: past the daily limit of wrong codes, even the right code is refused today.
    if ((await this.guardedLimits(() => this.limits.verifyFailures(phone))) >= this.maxFailures) {
      throw phoneLockedToday();
    }
    const attempt = await this.repo.recordAttempt(challengeId, phone, purpose, now);
    if (!attempt) throw new UnauthorizedException(INVALID_CODE);

    const expected = Buffer.from(attempt.codeHash, 'hex');
    const actual = Buffer.from(this.hash(challengeId, phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.guardedLimits(() => this.limits.recordVerifyFailure(phone));
      throw new UnauthorizedException(INVALID_CODE);
    }
    if (!(await this.repo.consume(challengeId, now))) {
      throw new UnauthorizedException(INVALID_CODE);
    }
  }

  /** Per phone AND purpose (a client login never uses up the photographer allowance); IP is global. */
  private async enforceLimits(
    repo: OtpRepository,
    phone: string,
    purpose: OtpPurpose,
    ip: string | null,
    now: Date,
  ): Promise<void> {
    const latest = await repo.latestCreatedAt(phone, purpose);
    if (latest) {
      const waitMs = latest.getTime() + OTP_POLICY.resendCooldownMs - now.getTime();
      if (waitMs > 0)
        throw rateLimited('Please wait before requesting another code', Math.ceil(waitMs / 1000));
    }
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    if ((await repo.countForPhoneSince(phone, purpose, hourAgo)) >= OTP_POLICY.maxPerPhonePerHour) {
      throw rateLimited('Too many codes requested for this number. Try again later.', 3600);
    }
    const dayAgo = new Date(now.getTime() - DAY_MS);
    if ((await repo.countForPhoneSince(phone, purpose, dayAgo)) >= OTP_POLICY.maxPerPhonePerDay) {
      throw rateLimited('Too many codes requested for this number today.', 86400);
    }
    // Always: a request without a usable IP counts in one shared bucket (audit H1), so sending
    // garbage cannot skip the limit.
    if ((await repo.countForIpSince(ip, hourAgo)) >= OTP_POLICY.maxPerIpPerHour) {
      throw rateLimited('Too many requests. Try again later.', 3600);
    }
  }

  private get maxFailures(): number {
    return this.limits.policy.maxVerifyFailuresPerPhonePerDay;
  }

  /** Audit M5: past a budget, no SMS — the same 503 for every number (it reveals nothing). */
  private assertSmsBudget(outcome: SmsReservation): void {
    if (outcome === 'OK') return;
    this.logger.warn(`OTP SMS refused by the SMS budget (${outcome})`);
    throw new ServiceUnavailableException({
      ...SMS_UNAVAILABLE,
      details: { retryAfterSeconds: this.limits.policy.circuitOpenMs / 1000 },
    });
  }

  /** The abuse counters live in Redis: without them, fail closed with the same 503. */
  private async guardedLimits<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `OTP limits store unavailable (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      throw new ServiceUnavailableException(SMS_UNAVAILABLE);
    }
  }

  /** Bound to the challenge id and phone, so a hash is useless outside its own challenge. */
  private hash(challengeId: string, phone: string, code: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${challengeId}:${phone}:${code}`)
      .digest('hex');
  }
}
