import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import {
  RedisThrottlerStorage,
  THROTTLE_BREAKER_MS,
  THROTTLE_WARN_EVERY_MS,
  type ThrottleRedis,
  throttleKeys,
} from './redis-throttler-storage';

const PREFIX = 'clickco-test';
const KEY = '1.2.3.4/32';

interface Call {
  readonly keys: readonly string[];
  readonly args: readonly string[];
}

/** Scripted stand-in for the shared ioredis client: records each EVAL, answers with `reply`. */
class FakeRedis implements ThrottleRedis {
  readonly calls: Call[] = [];

  constructor(
    private readonly reply: (call: Call) => unknown,
    public status = 'ready',
  ) {}

  async eval(_script: string, numKeys: number, ...rest: (string | number)[]): Promise<unknown> {
    const call = {
      keys: rest.slice(0, numKeys).map(String),
      args: rest.slice(numKeys).map(String),
    };
    this.calls.push(call);
    return this.reply(call);
  }
}

describe('RedisThrottlerStorage (ADR-0027 D6, identity and access audit L4)', () => {
  let now = new Date('2026-11-10T06:30:00.000Z');
  let warn: MockInstance;
  const storage = (redis: ThrottleRedis, timeoutMs?: number) =>
    new RedisThrottlerStorage(redis, PREFIX, () => now, timeoutMs ? { timeoutMs } : undefined);

  beforeEach(() => {
    now = new Date('2026-11-10T06:30:00.000Z');
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('counts under QUEUE_PREFIX, hashed (no tracker in the key), with ttl, limit and block in ms', async () => {
    const redis = new FakeRedis(() => [1, 60_000, 0, 0]);
    await storage(redis).increment(KEY, 60_000, 120, 60_000, 'default');
    const [call] = redis.calls;
    expect(call?.keys).toEqual(throttleKeys(PREFIX, KEY, 'default'));
    const [hits, block] = call?.keys ?? [];
    expect(hits).toMatch(/^clickco-test:throttle:\{[0-9a-f]{64}\}:hits$/);
    // Same hash tag: both keys sit in one cluster slot, so the script may touch both.
    expect(block).toBe(hits?.replace(/:hits$/, ':block'));
    expect(JSON.stringify(call?.keys)).not.toContain('1.2.3.4');
    expect(call?.args).toEqual(['60000', '120', '60000']);
  });

  it('keeps each tracker and each named throttler apart', () => {
    const [a] = throttleKeys(PREFIX, KEY, 'default');
    expect(throttleKeys(PREFIX, KEY, 'default')[0]).toBe(a);
    expect(throttleKeys(PREFIX, '5.6.7.8/32', 'default')[0]).not.toBe(a);
    expect(throttleKeys(PREFIX, KEY, 'burst')[0]).not.toBe(a);
    expect(throttleKeys('clickco-prod', KEY, 'default')[0]).not.toBe(a);
  });

  it('maps the reply to the record the guard expects (seconds, rounded up)', async () => {
    const counting = new FakeRedis(() => [3, 59_001, 0, 0]);
    expect(await storage(counting).increment(KEY, 60_000, 120, 60_000, 'default')).toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    const blocked = new FakeRedis(() => [121, 30_000, 1, 59_999]);
    expect(await storage(blocked).increment(KEY, 60_000, 120, 60_000, 'default')).toEqual({
      totalHits: 121,
      timeToExpire: 30,
      isBlocked: true,
      timeToBlockExpire: 60,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('fails open when Redis errors, warning at most once a minute', async () => {
    const down = new FakeRedis(() => {
      const error = new Error('connect ECONNREFUSED 10.0.0.5:6379');
      error.name = 'MaxRetriesPerRequestError';
      throw error;
    });
    const s = storage(down);
    const allowed = { totalHits: 0, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 };
    expect(await s.increment(KEY, 60_000, 120, 60_000, 'default')).toEqual(allowed);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/MaxRetriesPerRequestError.*allowed/);
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('10.0.0.5');

    for (let i = 0; i < 5; i += 1) {
      now = new Date(now.getTime() + 10_000); // past the breaker each time: Redis is tried again
      expect(await s.increment(KEY, 60_000, 120, 60_000, 'default')).toEqual(allowed);
    }
    expect(down.calls).toHaveLength(6);
    expect(warn).toHaveBeenCalledTimes(1); // 50 s on: still the one warning

    now = new Date(now.getTime() + THROTTLE_WARN_EVERY_MS);
    await s.increment(KEY, 60_000, 120, 60_000, 'default');
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]?.[0])).toMatch(
      /5 more allowed unchecked since the last warning/,
    );
  });

  it('fails open when Redis does not answer in time', async () => {
    const hung = new FakeRedis(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await storage(hung, 20).increment(KEY, 60_000, 120, 60_000, 'default')).toEqual({
      totalHits: 0,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ThrottleStoreTimeout/);
  });

  it('fails open at once, sending nothing, while the client is disconnected (no queued backlog)', async () => {
    for (const status of ['reconnecting', 'close', 'end']) {
      const offline = new FakeRedis(() => [1, 60_000, 0, 0], status);
      const record = await storage(offline).increment(KEY, 60_000, 120, 60_000, 'default');
      expect(record.isBlocked, status).toBe(false);
      expect(offline.calls, status).toHaveLength(0);
    }
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ThrottleStoreDisconnected/);
    // A lazy client that has not connected yet (or is connecting) is asked: that connects it.
    for (const status of ['wait', 'connecting', 'connect']) {
      const lazy = new FakeRedis(() => [1, 60_000, 0, 0], status);
      expect((await storage(lazy).increment(KEY, 60_000, 120, 60_000, 'default')).totalHits).toBe(
        1,
      );
      expect(lazy.calls, status).toHaveLength(1);
    }
  });

  it('after a failure, leaves Redis alone for a few seconds (circuit breaker), then tries again', async () => {
    let failing = true;
    const flaky = new FakeRedis(() => {
      if (failing) throw new Error('down');
      return [1, 60_000, 0, 0];
    });
    const s = storage(flaky);
    expect((await s.increment(KEY, 60_000, 120, 60_000, 'default')).totalHits).toBe(0);
    failing = false;
    now = new Date(now.getTime() + THROTTLE_BREAKER_MS - 1);
    expect((await s.increment(KEY, 60_000, 120, 60_000, 'default')).totalHits).toBe(0);
    expect(flaky.calls).toHaveLength(1); // skipped: allowed without a round trip
    now = new Date(now.getTime() + 1);
    expect((await s.increment(KEY, 60_000, 120, 60_000, 'default')).totalHits).toBe(1);
    expect(flaky.calls).toHaveLength(2);
  });

  it('fails open on a reply it does not understand', async () => {
    for (const reply of ['OK', [1, 2, 3], [1, '2', 0, 0], null]) {
      const odd = new FakeRedis(() => reply);
      const record = await storage(odd).increment(KEY, 60_000, 120, 60_000, 'default');
      expect(record.isBlocked).toBe(false);
    }
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/ThrottleStoreReplyError/);
  });

  it('refuses a ttl, limit or block that is not a finite number (a configuration error)', async () => {
    const redis = new FakeRedis(() => [1, 60_000, 0, 0]);
    const s = storage(redis);
    await expect(s.increment(KEY, Number.NaN, 120, 60_000, 'default')).rejects.toThrow(RangeError);
    await expect(s.increment(KEY, 60_000, Infinity, 60_000, 'default')).rejects.toThrow(RangeError);
    await expect(s.increment(KEY, 60_000, 120, -Infinity, 'default')).rejects.toThrow(RangeError);
    expect(redis.calls).toHaveLength(0);
  });
});
