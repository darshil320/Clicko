import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../../config/env';
import { WEBHOOK_SIGNATURE_LIMIT, WebhookSignatureLimiter } from '../webhook-signature-limiter';

function fakeRedis(opts: { down?: boolean } = {}) {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  const fail = () => {
    throw new Error('ECONNREFUSED');
  };
  return {
    counts,
    ttls,
    client: {
      incr: async (k: string) => {
        if (opts.down) fail();
        const n = (counts.get(k) ?? 0) + 1;
        counts.set(k, n);
        return n;
      },
      pexpire: async (k: string, ms: number) => {
        ttls.set(k, ms);
        return 1;
      },
      get: async (k: string) => {
        if (opts.down) fail();
        const n = counts.get(k);
        return n === undefined ? null : String(n);
      },
    },
  };
}

const env = { QUEUE_PREFIX: 'clickco-test' } as Env;

describe('WebhookSignatureLimiter (audit M3)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('blocks an IP once it has sent the maximum of bad signatures in the window', async () => {
    const redis = fakeRedis();
    const limiter = new WebhookSignatureLimiter(redis.client as unknown as Redis, env);
    for (let i = 0; i < WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp; i++) {
      expect(await limiter.overLimit('198.51.100.7')).toBe(false);
      await limiter.recordInvalid('198.51.100.7');
    }
    expect(await limiter.overLimit('198.51.100.7')).toBe(true);
    expect(await limiter.overLimit('198.51.100.8')).toBe(false);
    expect([...redis.ttls.values()]).toEqual([WEBHOOK_SIGNATURE_LIMIT.windowMs]);
    expect([...redis.counts.keys()][0]).toMatch(/^clickco-test:webhook-invalid:/);
    // The IP is hashed: no address sits in Redis.
    expect([...redis.counts.keys()][0]).not.toContain('198.51.100.7');
  });

  it('fails open when Redis is down (the signature check still refuses forgeries)', async () => {
    const limiter = new WebhookSignatureLimiter(
      fakeRedis({ down: true }).client as unknown as Redis,
      env,
    );
    expect(await limiter.overLimit('198.51.100.7')).toBe(false);
    await expect(limiter.recordInvalid('198.51.100.7')).resolves.toBeUndefined();
  });
});
