import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../../config/env';
import { TEST_REDIS_URL } from '../../../test-support/e2e-app';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { BullQueues } from '../bull-queues';
import { JobRegistry } from '../job-registry';
import { BullJobScheduler } from '../job-scheduler';
import { JOB, QUEUE } from '../queue-names';
import { QueueWorkers } from '../queue-workers';
import { redisOptions } from '../redis';

const NOW = new Date('2026-11-10T06:30:00.000Z');

const envFor = (prefix: string, workers: 'on' | 'off') =>
  loadEnv({
    NODE_ENV: 'test',
    PORT: '0',
    DATABASE_URL: 'postgres://unused:unused@localhost:5433/unused',
    REDIS_URL: TEST_REDIS_URL,
    QUEUE_PREFIX: prefix,
    QUEUE_WORKERS: workers,
    JWT_ACCESS_SECRET: 'queues-test-access-secret-0123456789',
    OTP_HASH_PEPPER: 'queues-test-otp-pepper-0123456789ab',
    SMS_ADAPTER: 'console',
  });

describe('redisOptions', () => {
  it('decodes the password, db and TLS from REDIS_URL', () => {
    expect(redisOptions('rediss://:p%40ss@cache.internal:6390/2')).toEqual({
      host: 'cache.internal',
      port: 6390,
      password: 'p@ss',
      db: 2,
      tls: {},
    });
    expect(redisOptions('redis://localhost')).toEqual({ host: 'localhost', port: 6379, db: 0 });
  });
});

describe.runIf(TEST_DATABASE_URL)('BullMQ in Redis', () => {
  const prefix = `clickco-qtest-${randomBytes(4).toString('hex')}`;
  let queues: BullQueues;

  beforeAll(() => {
    Logger.overrideLogger(false);
    queues = new BullQueues(envFor(prefix, 'on'));
  });

  afterAll(async () => {
    await queues?.onApplicationShutdown();
    const redis = new Redis(TEST_REDIS_URL);
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  it('schedules a delayed job by absolute time, once per job id', async () => {
    const scheduler = new BullJobScheduler(queues, () => NOW);
    const at = new Date(NOW.getTime() + 120_000);
    await scheduler.runAt(JOB.DISPATCH_WAVE_EXPIRY, { roundId: 'r-1' }, at, 'wave-expiry-r1');
    await scheduler.runAt(JOB.DISPATCH_WAVE_EXPIRY, { roundId: 'r-1' }, at, 'wave-expiry-r1');
    const queue = queues.get(QUEUE.DISPATCH);
    const job = await queue.getJob('wave-expiry-r1');
    expect(job).toMatchObject({ name: JOB.DISPATCH_WAVE_EXPIRY, data: { roundId: 'r-1' } });
    expect(job?.opts.delay).toBe(120_000);
    expect(await queue.getDelayedCount()).toBe(1);
    await expect(scheduler.runAt(JOB.DISPATCH_WAVE_EXPIRY, {}, at, 'bad:id')).rejects.toThrow(
      /must not contain/,
    );
  });

  it('workers route jobs to registered processors and register the repeatable jobs', async () => {
    const registry = new JobRegistry();
    const seen = new Promise<unknown>((resolve) => {
      registry.register(JOB.DISPATCH_SWEEP, { process: async (data) => resolve(data) });
    });
    const workers = new QueueWorkers(envFor(prefix, 'on'), queues, registry);
    workers.onApplicationBootstrap();
    try {
      await queues.get(QUEUE.DISPATCH).add(JOB.DISPATCH_SWEEP, { n: 1 });
      const data = await Promise.race([
        seen,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10_000)),
      ]);
      expect(data).toEqual({ n: 1 });
      // Registration runs in the background (boot never waits on Redis): poll briefly.
      let keys: string[] = [];
      for (let i = 0; i < 50 && !keys.includes(JOB.OUTBOX_PUBLISH); i++) {
        keys = (await queues.get(QUEUE.OUTBOX).getJobSchedulers()).map((s) => s.key);
        if (!keys.includes(JOB.OUTBOX_PUBLISH)) await new Promise((r) => setTimeout(r, 100));
      }
      expect(keys).toContain(JOB.OUTBOX_PUBLISH);
    } finally {
      await workers.onApplicationShutdown();
    }
  });

  it('refuses a second processor for the same job', () => {
    const registry = new JobRegistry();
    registry.register(JOB.OUTBOX_PUBLISH, { process: async () => {} });
    expect(() => registry.register(JOB.OUTBOX_PUBLISH, { process: async () => {} })).toThrow(
      /already registered/,
    );
  });
});
