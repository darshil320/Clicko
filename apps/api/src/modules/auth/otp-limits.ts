import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Clock } from '../../common/clock';

/**
 * OTP abuse limits that span every number (security audit M5, L2), in Redis:
 * - an hourly global SMS budget — past it, a circuit breaker stops every OTP SMS for a cool-down
 *   and ops are alerted (SMS pumping / toll fraud costs money per message);
 * - an hourly budget per number prefix (country code + the first digits), so one number range
 *   cannot be pumped while the rest of the country keeps working;
 * - failed verifies per phone per day: past the limit, that phone is locked until the window ends.
 * Phone numbers are hashed in keys; a prefix alone is not personal data.
 */
export const OTP_LIMITS_POLICY = {
  smsGlobalPerHour: 3_000,
  smsPerPrefixPerHour: 300,
  /** `+91` and the first five digits: one operator series. */
  prefixLength: 8,
  circuitOpenMs: 15 * 60 * 1000,
  maxVerifyFailuresPerPhonePerDay: 10,
  verifyFailureWindowMs: 24 * 60 * 60 * 1000,
} as const;

export type OtpLimitsPolicy = { readonly [K in keyof typeof OTP_LIMITS_POLICY]: number };

export type SmsReservation = 'OK' | 'CIRCUIT_OPEN' | 'GLOBAL_BUDGET' | 'PREFIX_BUDGET';

export interface OtpLimits {
  /** Counts one SMS against the global and prefix budgets; 'OK' or why it must not be sent. */
  reserveSms(phone: string): Promise<SmsReservation>;
  verifyFailures(phone: string): Promise<number>;
  recordVerifyFailure(phone: string): Promise<number>;
  readonly policy: OtpLimitsPolicy;
}

export const OTP_LIMITS = Symbol('OTP_LIMITS');

/**
 * KEYS: breaker, global hour counter, prefix hour counter.
 * ARGV: now ms, global limit, prefix limit, breaker ms, counter ttl ms.
 * The breaker holds the instant it closes (the app clock, not Redis time, decides).
 * Returns the outcome, with a `TRIPPED`/`PREFIX_FIRST` marker the first time a limit is crossed.
 */
const RESERVE = `
local now = tonumber(ARGV[1])
local openUntil = tonumber(redis.call('get', KEYS[1]) or '0')
if openUntil > now then return 'CIRCUIT_OPEN' end
local global = redis.call('incr', KEYS[2])
redis.call('pexpire', KEYS[2], ARGV[5], 'NX')
local prefix = redis.call('incr', KEYS[3])
redis.call('pexpire', KEYS[3], ARGV[5], 'NX')
if global > tonumber(ARGV[2]) then
  redis.call('set', KEYS[1], tostring(now + tonumber(ARGV[4])), 'PX', tonumber(ARGV[4]) * 2)
  return 'GLOBAL_BUDGET'
end
if prefix > tonumber(ARGV[3]) then
  if prefix == tonumber(ARGV[3]) + 1 then return 'PREFIX_BUDGET_FIRST' end
  return 'PREFIX_BUDGET'
end
return 'OK'`;

const COUNT = `
local n = redis.call('incr', KEYS[1])
redis.call('pexpire', KEYS[1], ARGV[1], 'NX')
return n`;

const HOUR_MS = 60 * 60 * 1000;

const phoneTag = (phone: string): string =>
  createHash('sha256').update(`otp-limits:${phone}`).digest('hex').slice(0, 32);

export class RedisOtpLimits implements OtpLimits {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly clock: Clock,
    readonly policy: OtpLimitsPolicy = OTP_LIMITS_POLICY,
    private readonly onAlert: (message: string) => void = () => undefined,
  ) {}

  async reserveSms(phone: string): Promise<SmsReservation> {
    const now = this.clock().getTime();
    const hour = Math.floor(now / HOUR_MS);
    const series = phone.slice(0, this.policy.prefixLength);
    const reply = String(
      await this.redis.eval(
        RESERVE,
        3,
        this.key('sms:breaker'),
        this.key(`sms:global:${hour}`),
        this.key(`sms:prefix:${series}:${hour}`),
        String(now),
        String(this.policy.smsGlobalPerHour),
        String(this.policy.smsPerPrefixPerHour),
        String(this.policy.circuitOpenMs),
        String(2 * HOUR_MS),
      ),
    );
    if (reply === 'GLOBAL_BUDGET') {
      this.onAlert(
        `OTP SMS global budget (${this.policy.smsGlobalPerHour}/h) exceeded: circuit breaker open for ${this.policy.circuitOpenMs / 60_000} min`,
      );
      return 'GLOBAL_BUDGET';
    }
    if (reply === 'PREFIX_BUDGET_FIRST') {
      this.onAlert(
        `OTP SMS budget for number prefix ${series} (${this.policy.smsPerPrefixPerHour}/h) exceeded`,
      );
      return 'PREFIX_BUDGET';
    }
    return reply as SmsReservation;
  }

  async verifyFailures(phone: string): Promise<number> {
    return Number((await this.redis.get(this.verifyKey(phone))) ?? 0);
  }

  async recordVerifyFailure(phone: string): Promise<number> {
    return Number(
      await this.redis.eval(
        COUNT,
        1,
        this.verifyKey(phone),
        String(this.policy.verifyFailureWindowMs),
      ),
    );
  }

  private verifyKey(phone: string): string {
    return this.key(`verify-fail:${phoneTag(phone)}`);
  }

  private key(suffix: string): string {
    return `${this.prefix}:otp:${suffix}`;
  }
}
