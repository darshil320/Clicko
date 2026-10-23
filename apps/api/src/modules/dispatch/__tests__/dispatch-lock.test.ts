import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../config/env';
import { RedisLocks } from '../../../infra/queues/redis-lock';
import { DispatchLock } from '../dispatch-lock';

const env = { QUEUE_PREFIX: 'clickco-unit' } as Env;

describe('DispatchLock (on RedisLocks)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('SET NX PX 15000 on a namespaced key; OK = acquired, null = taken', async () => {
    const set = vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const lock = new DispatchLock(new RedisLocks({ set } as unknown as Redis, env));
    expect(await lock.acquire('b-1', 'att-1')).toBe('ACQUIRED');
    expect(await lock.acquire('b-1', 'att-2')).toBe('TAKEN');
    expect(set).toHaveBeenCalledWith(
      'clickco-unit:dispatch:booking:b-1',
      'att-1',
      'PX',
      15_000,
      'NX',
    );
  });

  it('degrades to UNAVAILABLE when Redis is down (Postgres stays the guarantee)', async () => {
    const set = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const lock = new DispatchLock(new RedisLocks({ set } as unknown as Redis, env));
    expect(await lock.acquire('b-1', 'att-1')).toBe('UNAVAILABLE');
  });

  it('releases only its own token, and never throws on release', async () => {
    const evalFn = vi.fn().mockRejectedValue(new Error('down'));
    const lock = new DispatchLock(new RedisLocks({ eval: evalFn } as unknown as Redis, env));
    await expect(lock.release('b-1', 'att-1')).resolves.toBeUndefined();
    expect(evalFn).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get'"),
      1,
      'clickco-unit:dispatch:booking:b-1',
      'att-1',
    );
  });
});
