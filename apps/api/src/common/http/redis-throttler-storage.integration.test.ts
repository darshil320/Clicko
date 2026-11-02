import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeRedisClient, createRedisClient } from '../../infra/queues/redis';
import { TEST_REDIS_URL } from '../../test-support/e2e-app';
import { TEST_DATABASE_URL } from '../../test-support/scratch-db';
import { RedisThrottlerStorage, throttleKeys } from './redis-throttler-storage';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The Docker Redis comes up with the Docker Postgres (`pnpm db:up`): skipped without it.
describe.runIf(TEST_DATABASE_URL)('RedisThrottlerStorage (Docker Redis)', () => {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const prefix = `clickco-test-throttle-${randomBytes(4).toString('hex')}`;
  const storage = new RedisThrottlerStorage(redis, prefix, () => new Date());

  beforeAll(async () => {
    Logger.overrideLogger(false);
    await redis.connect();
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it('allows the limit, then blocks for the block duration without counting', async () => {
    const hits = [];
    for (let i = 0; i < 4; i += 1) {
      hits.push(await storage.increment('tracker-a', 60_000, 3, 30_000, 'default'));
    }
    expect(hits.map((h) => [h.totalHits, h.isBlocked])).toEqual([
      [1, false],
      [2, false],
      [3, false],
      [4, true],
    ]);
    expect(hits[0]?.timeToExpire).toBe(60);
    expect(hits[3]?.timeToBlockExpire).toBe(30);
    const [hitKey, blockKey] = throttleKeys(prefix, 'tracker-a', 'default');
    // The window starts over once the block ends; meanwhile nothing is counted.
    expect(await redis.exists(hitKey)).toBe(0);
    const blockTtl = await redis.pttl(blockKey);
    expect(blockTtl).toBeGreaterThan(29_000);
    expect(blockTtl).toBeLessThanOrEqual(30_000);
    const again = await storage.increment('tracker-a', 60_000, 3, 30_000, 'default');
    expect(again.isBlocked).toBe(true);
    expect(await redis.exists(hitKey)).toBe(0);
  });

  it('every key lives under QUEUE_PREFIX and expires', async () => {
    await storage.increment('tracker-b', 60_000, 3, 60_000, 'default');
    const [hitKey] = throttleKeys(prefix, 'tracker-b', 'default');
    const ttl = await redis.pttl(hitKey);
    expect(ttl).toBeGreaterThan(59_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
    const keys = await redis.keys(`${prefix}:throttle:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(await redis.pttl(key)).toBeGreaterThan(0);
  });

  it('is atomic: 40 requests at once against a limit of 10 let exactly 10 through', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, () => storage.increment('tracker-c', 60_000, 10, 60_000, 'x')),
    );
    expect(results.filter((r) => !r.isBlocked)).toHaveLength(10);
    expect(
      results
        .filter((r) => !r.isBlocked)
        .map((r) => r.totalHits)
        .sort((a, b) => a - b),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('counts afresh once the block runs out', async () => {
    for (let i = 0; i < 2; i += 1) await storage.increment('tracker-d', 1_000, 1, 150, 'default');
    expect((await storage.increment('tracker-d', 1_000, 1, 150, 'default')).isBlocked).toBe(true);
    await sleep(200);
    const after = await storage.increment('tracker-d', 1_000, 1, 150, 'default');
    expect([after.totalHits, after.isBlocked]).toEqual([1, false]);
  });

  it('without a block duration, refuses past the limit until the window ends', async () => {
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await storage.increment('tracker-e', 60_000, 2, 0, 'default'));
    }
    expect(results.map((r) => r.isBlocked)).toEqual([false, false, true]);
    expect(results[2]?.timeToBlockExpire).toBe(60);
  });

  it('fails open (allows) when Redis cannot be reached', async () => {
    const nowhere = createRedisClient('redis://127.0.0.1:1');
    try {
      const open = new RedisThrottlerStorage(nowhere, prefix, () => new Date(), {
        timeoutMs: 300,
      });
      const record = await open.increment('tracker-f', 60_000, 1, 60_000, 'default');
      expect(record).toEqual({
        totalHits: 0,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      });
      // The client now knows it is disconnected: a fresh storage (no breaker yet) does not queue
      // a command or wait for the timeout, it lets the request through at once.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(['reconnecting', 'close', 'end']).toContain(nowhere.status);
      const fresh = new RedisThrottlerStorage(nowhere, prefix, () => new Date(), {
        timeoutMs: 300,
      });
      const sent = vi.spyOn(nowhere, 'eval');
      const started = Date.now();
      expect((await fresh.increment('tracker-f', 60_000, 1, 60_000, 'default')).isBlocked).toBe(
        false,
      );
      expect(Date.now() - started).toBeLessThan(100);
      expect(sent).not.toHaveBeenCalled(); // nothing queued in the client while it is down
    } finally {
      await closeRedisClient(nowhere);
    }
  });
});
