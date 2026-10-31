import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_REDIS_URL } from '../../../test-support/e2e-app';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { OTP_LIMITS_POLICY, RedisOtpLimits } from '../otp-limits';

const SMALL = {
  ...OTP_LIMITS_POLICY,
  smsGlobalPerHour: 5,
  smsPerPrefixPerHour: 3,
  maxVerifyFailuresPerPhonePerDay: 3,
} as const;

describe.runIf(TEST_DATABASE_URL)('RedisOtpLimits (security audit M5, L2)', () => {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const prefix = `clickco-test-otp-${randomBytes(4).toString('hex')}`;
  let now = new Date('2026-11-10T06:10:00.000Z');
  const limits = new RedisOtpLimits(redis, prefix, () => now, SMALL);

  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    await redis.quit();
  });

  it('M5: caps SMS per number prefix per hour (a pumping attack on one range)', async () => {
    const outcomes = [];
    for (let i = 0; i < 4; i += 1) outcomes.push(await limits.reserveSms(`+9198765${i}0000`));
    expect(outcomes).toEqual(['OK', 'OK', 'OK', 'PREFIX_BUDGET']);
    expect(await limits.reserveSms('+919123400000')).toBe('OK');
  });

  it('M5: the global hourly budget trips a circuit breaker that stays open for its cool-down', async () => {
    // 5 counted so far (4 + 1); the next is over the global budget.
    expect(await limits.reserveSms('+917000000001')).toBe('GLOBAL_BUDGET');
    now = new Date(now.getTime() + 10 * 60_000); // inside the 15-minute cool-down
    expect(await limits.reserveSms('+917000000002')).toBe('CIRCUIT_OPEN');
    now = new Date(now.getTime() + 50 * 60_000); // a new hour, the breaker closed
    expect(await limits.reserveSms('+917000000003')).toBe('OK');
  });

  it('L2: counts failed verifies per phone for a day', async () => {
    const phone = '+919800011122';
    expect(await limits.verifyFailures(phone)).toBe(0);
    for (let i = 0; i < 3; i += 1) await limits.recordVerifyFailure(phone);
    expect(await limits.verifyFailures(phone)).toBe(3);
    expect(await limits.verifyFailures('+919800011123')).toBe(0);
    const ttl = await redis.pttl((await redis.keys(`${prefix}:otp:verify-fail:*`))[0] as string);
    expect(ttl).toBeGreaterThan(23 * 3_600_000);
  });

  it('never stores the phone number in a key', async () => {
    const keys = await redis.keys(`${prefix}:*`);
    expect(keys.some((k) => k.includes('9800011122'))).toBe(false);
  });
});
