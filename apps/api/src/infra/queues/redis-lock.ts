import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { REDIS } from './redis';

/** Deletes the key only if it still holds our token: never release someone else's lock. */
const RELEASE_IF_OWNER = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

export type LockResult = 'ACQUIRED' | 'TAKEN' | 'UNAVAILABLE';

/**
 * `SET <prefix>:<key> <token> NX PX <ttl>` — short mutual-exclusion leases (dispatch accept,
 * payment capture/release). Callers decide what UNAVAILABLE (Redis down) means for them.
 */
@Injectable()
export class RedisLocks {
  private readonly logger = new Logger(RedisLocks.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async acquire(key: string, token: string, ttlMs: number): Promise<LockResult> {
    try {
      const reply = await this.redis.set(this.fullKey(key), token, 'PX', ttlMs, 'NX');
      return reply === 'OK' ? 'ACQUIRED' : 'TAKEN';
    } catch (error) {
      this.logger.warn(`Lock ${key} unavailable: ${error instanceof Error ? error.name : 'error'}`);
      return 'UNAVAILABLE';
    }
  }

  /** Best effort: the lease expires by itself; a failed release only delays the next holder. */
  async release(key: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_IF_OWNER, 1, this.fullKey(key), token);
    } catch (error) {
      this.logger.warn(
        `Could not release lock ${key}: ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  private fullKey(key: string): string {
    return `${this.env.QUEUE_PREFIX}:${key}`;
  }
}
