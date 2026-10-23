import type { Redis } from 'ioredis';
import type { Clock } from '../../common/clock';

/**
 * Bytes written to a provider in the rolling last 24 h (doc 02 §6 "daily upload ceiling"). Drive caps
 * uploads at ~750 GB/day per account; new upload sessions are refused past 85 % (MediaService).
 * Hour-granular: the window is the current hour plus the 23 before it.
 */
export interface UploadBudget {
  record(adapter: string, bytes: number): Promise<void>;
  uploadedLast24h(adapter: string): Promise<number>;
}

export const UPLOAD_BUDGET = Symbol('UPLOAD_BUDGET');

const HOUR_MS = 3_600_000;
const WINDOW_HOURS = 24;
/** A bucket outlives its window by an hour so the sum never reads a half-expired key. */
const BUCKET_TTL_SECONDS = (WINDOW_HOURS + 1) * 3_600;

const hourOf = (at: Date): number => Math.floor(at.getTime() / HOUR_MS);

function assertBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError(`UploadBudget: bytes must be a non-negative integer, got ${bytes}`);
  }
}

/** Redis hourly buckets `{prefix}:storage:uploaded:{adapter}:{hour}` (shared by every API instance). */
export class RedisUploadBudget implements UploadBudget {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
    private readonly clock: Clock,
  ) {}

  private key(adapter: string, hour: number): string {
    return `${this.prefix}:storage:uploaded:${adapter}:${hour}`;
  }

  async record(adapter: string, bytes: number): Promise<void> {
    assertBytes(bytes);
    if (bytes === 0) return;
    const key = this.key(adapter, hourOf(this.clock()));
    await this.redis.multi().incrby(key, bytes).expire(key, BUCKET_TTL_SECONDS).exec();
  }

  async uploadedLast24h(adapter: string): Promise<number> {
    const now = hourOf(this.clock());
    const keys = Array.from({ length: WINDOW_HOURS }, (_, i) => this.key(adapter, now - i));
    const values = await this.redis.mget(...keys);
    return values.reduce((sum, v) => sum + (v === null ? 0 : Number.parseInt(v, 10)), 0);
  }
}

/** Process-local budget for unit tests and the adapter contract suite. */
export class MemoryUploadBudget implements UploadBudget {
  private readonly buckets = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  async record(adapter: string, bytes: number): Promise<void> {
    assertBytes(bytes);
    const key = `${adapter}:${hourOf(this.clock())}`;
    this.buckets.set(key, (this.buckets.get(key) ?? 0) + bytes);
  }

  async uploadedLast24h(adapter: string): Promise<number> {
    const now = hourOf(this.clock());
    let sum = 0;
    for (let i = 0; i < WINDOW_HOURS; i++) sum += this.buckets.get(`${adapter}:${now - i}`) ?? 0;
    return sum;
  }
}
