import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { REDIS } from '../../infra/queues/redis';

/** Audit M3: bad webhook signatures per caller IP, per window. Valid signatures are never limited. */
export const WEBHOOK_SIGNATURE_LIMIT = {
  maxInvalidPerIp: 10,
  windowMs: 15 * 60_000,
} as const;

/**
 * The payment webhook route skips the global per-IP throttle (the gateway retries in bursts from a
 * few IPs). Instead, only requests with a BAD signature are counted per caller IP in Redis; past
 * the limit that IP's unverified requests get 429 before anything is stored. The IP is hashed, so
 * no address sits in Redis. Redis down = fail open: the HMAC check still refuses every forgery.
 */
@Injectable()
export class WebhookSignatureLimiter {
  private readonly logger = new Logger(WebhookSignatureLimiter.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private key(ip: string): string {
    const window = Math.floor(Date.now() / WEBHOOK_SIGNATURE_LIMIT.windowMs);
    const hashed = createHash('sha256').update(ip).digest('hex').slice(0, 32);
    return `${this.env.QUEUE_PREFIX}:webhook-invalid:${window}:${hashed}`;
  }

  async overLimit(ip: string): Promise<boolean> {
    try {
      const n = Number((await this.redis.get(this.key(ip))) ?? 0);
      return n >= WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp;
    } catch (error) {
      this.warn(error);
      return false;
    }
  }

  async recordInvalid(ip: string): Promise<void> {
    try {
      const key = this.key(ip);
      if ((await this.redis.incr(key)) === 1) {
        await this.redis.pexpire(key, WEBHOOK_SIGNATURE_LIMIT.windowMs);
      }
    } catch (error) {
      this.warn(error);
    }
  }

  private warn(error: unknown): void {
    this.logger.warn(
      `Webhook limiter unavailable (${error instanceof Error ? error.message : 'error'})`,
    );
  }
}
