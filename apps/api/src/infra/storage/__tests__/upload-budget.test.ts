import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_REDIS_URL } from '../../../test-support/e2e-app';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { MemoryUploadBudget, RedisUploadBudget, type UploadBudget } from '../upload-budget';

const HOUR = 3_600_000;

function rollingWindowCases(make: (clock: () => Date) => UploadBudget | Promise<UploadBudget>) {
  it('sums the last 24 hours and forgets older bytes', async () => {
    let now = new Date('2026-11-10T00:30:00Z');
    const budget = await make(() => now);
    await budget.record('LOCAL_DISK', 100);
    now = new Date(now.getTime() + 10 * HOUR);
    await budget.record('LOCAL_DISK', 50);
    await budget.record('GOOGLE_DRIVE', 7);
    expect(await budget.uploadedLast24h('LOCAL_DISK')).toBe(150);
    expect(await budget.uploadedLast24h('GOOGLE_DRIVE')).toBe(7);
    now = new Date(now.getTime() + 15 * HOUR); // the first 100 bytes are now 25 h old
    expect(await budget.uploadedLast24h('LOCAL_DISK')).toBe(50);
  });

  it('refuses negative or fractional byte counts', async () => {
    const budget = await make(() => new Date());
    await expect(budget.record('LOCAL_DISK', -1)).rejects.toThrow(RangeError);
    await expect(budget.record('LOCAL_DISK', 1.5)).rejects.toThrow(RangeError);
  });
}

describe('MemoryUploadBudget', () => {
  rollingWindowCases((clock) => new MemoryUploadBudget(clock));
});

describe.runIf(TEST_DATABASE_URL)('RedisUploadBudget (Docker Redis)', () => {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const prefix = `clickco-test-budget-${randomBytes(4).toString('hex')}`;

  beforeAll(async () => {
    await redis.connect();
  });
  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  rollingWindowCases((clock) => new RedisUploadBudget(redis, prefix, clock));

  it('expires its buckets', async () => {
    const budget = new RedisUploadBudget(redis, `${prefix}-ttl`, () => new Date());
    await budget.record('LOCAL_DISK', 10);
    const [key] = await redis.keys(`${prefix}-ttl:*`);
    expect(await redis.ttl(key as string)).toBeGreaterThan(24 * 3_600);
  });
});
