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
import { OTP_REPOSITORY, type OtpRepository } from './repositories/otp.repository';
import { SMS_PORT, type SmsPort } from './sms/sms.port';

export const OTP_PEPPER = Symbol('OTP_PEPPER');

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
    @Inject(SMS_PORT) private readonly sms: SmsPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OTP_PEPPER) private readonly pepper: string,
  ) {}

  async request(
    phone: string,
    purpose: OtpPurpose,
    ip: string | null,
  ): Promise<RequestOtpResponse> {
    const now = this.clock();
    const id = randomUUID();
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(now.getTime() + OTP_POLICY.ttlMs);

    await this.repo.withLocks(phone, ip, async (repo) => {
      await this.enforceLimits(repo, phone, ip, now);
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
      await this.sms.sendOtp(phone, code);
    } catch (error) {
      // The row stays and counts toward rate limits, so a failing gateway can't be hammered.
      // Name only: provider errors can carry the request (phone, code, API key).
      this.logger.error(
        `OTP SMS send failed (${error instanceof Error ? error.name : 'unknown error'})`,
      );
      throw new ServiceUnavailableException({
        code: 'SMS_UNAVAILABLE',
        message: 'We could not send the code right now. Please try again shortly.',
      });
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
    const attempt = await this.repo.recordAttempt(challengeId, phone, purpose, now);
    if (!attempt) throw new UnauthorizedException(INVALID_CODE);

    const expected = Buffer.from(attempt.codeHash, 'hex');
    const actual = Buffer.from(this.hash(challengeId, phone, code), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    if (!(await this.repo.consume(challengeId, now))) {
      throw new UnauthorizedException(INVALID_CODE);
    }
  }

  private async enforceLimits(
    repo: OtpRepository,
    phone: string,
    ip: string | null,
    now: Date,
  ): Promise<void> {
    const latest = await repo.latestCreatedAt(phone);
    if (latest) {
      const waitMs = latest.getTime() + OTP_POLICY.resendCooldownMs - now.getTime();
      if (waitMs > 0)
        throw rateLimited('Please wait before requesting another code', Math.ceil(waitMs / 1000));
    }
    const hourAgo = new Date(now.getTime() - HOUR_MS);
    if ((await repo.countForPhoneSince(phone, hourAgo)) >= OTP_POLICY.maxPerPhonePerHour) {
      throw rateLimited('Too many codes requested for this number. Try again later.', 3600);
    }
    const dayAgo = new Date(now.getTime() - DAY_MS);
    if ((await repo.countForPhoneSince(phone, dayAgo)) >= OTP_POLICY.maxPerPhonePerDay) {
      throw rateLimited('Too many codes requested for this number today.', 86400);
    }
    if (ip && (await repo.countForIpSince(ip, hourAgo)) >= OTP_POLICY.maxPerIpPerHour) {
      throw rateLimited('Too many requests. Try again later.', 3600);
    }
  }

  /** Bound to the challenge id and phone, so a hash is useless outside its own challenge. */
  private hash(challengeId: string, phone: string, code: string): string {
    return createHmac('sha256', this.pepper)
      .update(`${challengeId}:${phone}:${code}`)
      .digest('hex');
  }
}
