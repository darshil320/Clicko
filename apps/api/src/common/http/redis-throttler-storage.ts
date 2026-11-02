import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Clock } from '../clock';

/** What `ThrottlerStorage.increment` resolves to (the package does not export the type itself). */
export type ThrottleRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** What this storage needs from the shared ioredis client (a fake in unit tests). */
export interface ThrottleRedis {
  /** ioredis connection state. */
  readonly status: string;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** How long a request waits for Redis before it is let through unthrottled. */
export const THROTTLE_STORE_TIMEOUT_MS = 1_000;
/** After a failure, requests skip Redis (and are allowed) for this long (per process). */
export const THROTTLE_BREAKER_MS = 5_000;
/** While Redis is unreachable, at most one warning per this interval (per process). */
export const THROTTLE_WARN_EVERY_MS = 60_000;

/**
 * Client states in which ioredis would hold a command in its offline queue until a reconnect: the
 * request is let through at once instead, so an outage builds no backlog to replay and adds no
 * wait. A lazy client that has not connected yet ('wait') is asked: that connects it.
 */
const DISCONNECTED: ReadonlySet<string> = new Set(['reconnecting', 'close', 'end']);

/**
 * KEYS: the window's hit counter, the block marker. ARGV: ttl ms, limit, block ms.
 * One script, so the count, its expiry and the block decision are a single atomic step on every
 * instance. A fixed window: the counter expires `ttl` after its first hit. Past the limit the
 * caller is blocked for `block` ms (the guard passes the ttl when a route sets none) and the
 * counter is dropped, so the window starts afresh when the block ends; blocked requests are not
 * counted. With no block duration a refusal lasts until the window ends.
 * Returns {totalHits, ms to window end, blocked 0/1, ms to block end}.
 */
const INCREMENT = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return {tonumber(ARGV[2]) + 1, blockTtl, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits <= tonumber(ARGV[2]) then
  return {hits, ttl, 0, 0}
end
local blockMs = tonumber(ARGV[3])
if blockMs > 0 then
  redis.call('SET', KEYS[2], '1', 'PX', blockMs)
  redis.call('DEL', KEYS[1])
  return {hits, ttl, 1, blockMs}
end
return {hits, ttl, 1, ttl}`;

class ThrottleStoreTimeout extends Error {
  constructor(ms: number) {
    super(`No reply from the rate-limit store within ${ms} ms`);
    this.name = 'ThrottleStoreTimeout';
  }
}

class ThrottleStoreDisconnected extends Error {
  constructor(status: string) {
    super(`The rate-limit store's client is ${status}`);
    this.name = 'ThrottleStoreDisconnected';
  }
}

class ThrottleStoreReplyError extends Error {
  constructor() {
    super('Unexpected reply from the rate-limit store');
    this.name = 'ThrottleStoreReplyError';
  }
}

/**
 * `{prefix}:throttle:{<sha256>}:hits|block`. The guard's key is already a hash, but it is hashed
 * again with the throttler name so no caller-supplied key (a raw IP from a custom generateKey)
 * ever lands in Redis, and so the shared hash tag puts both keys in one cluster slot.
 */
export function throttleKeys(
  prefix: string,
  key: string,
  throttlerName: string,
): readonly [string, string] {
  const tag = createHash('sha256').update(`${throttlerName}\n${key}`).digest('hex');
  const base = `${prefix}:throttle:{${tag}}`;
  return [`${base}:hits`, `${base}:block`];
}

const seconds = (ms: number): number => Math.max(0, Math.ceil(ms / 1_000));

/** The record of a request let through without counting (fail open). */
const allowed = (ttlMs: number): ThrottleRecord => ({
  totalHits: 0,
  timeToExpire: seconds(ttlMs),
  isBlocked: false,
  timeToBlockExpire: 0,
});

function finite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`Throttler ${name} must be a finite number, got ${value}`);
  }
  return value;
}

function parseReply(reply: unknown): ThrottleRecord {
  if (
    !Array.isArray(reply) ||
    reply.length !== 4 ||
    !reply.every((v) => typeof v === 'number' && Number.isSafeInteger(v))
  ) {
    throw new ThrottleStoreReplyError();
  }
  const [totalHits, windowMs, blocked, blockMs] = reply as [number, number, number, number];
  return {
    totalHits,
    timeToExpire: seconds(windowMs),
    isBlocked: blocked === 1,
    timeToBlockExpire: blocked === 1 ? seconds(blockMs) : 0,
  };
}

/**
 * The global per-IP throttler's counters in the shared Redis (ADR-0027 D6, identity and access
 * audit L4), so every API instance counts against one limit instead of each allowing the full
 * limit on its own.
 *
 * **Fails open.** If Redis errors, does not answer within THROTTLE_STORE_TIMEOUT_MS, or the
 * client is disconnected, the request is allowed and a warning is logged, at most once per
 * THROTTLE_WARN_EVERY_MS. After a failure, requests skip Redis for THROTTLE_BREAKER_MS (allowed,
 * no round trip), so an outage neither queues commands nor slows every request. This throttle is
 * a backstop: the OTP limits (Postgres + Redis) and the staff lockouts are separate and enforced
 * on their own, so a Redis outage must not take the whole API down with it.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly timeoutMs: number;
  /** When the next "store unreachable" warning may be logged, and how many were held back. */
  private warnAfter = 0;
  private heldBack = 0;
  /** Until when requests skip Redis after a failure (the circuit breaker). */
  private skipUntil = 0;

  constructor(
    private readonly redis: ThrottleRedis,
    private readonly prefix: string,
    private readonly clock: Clock,
    options?: { readonly timeoutMs: number },
  ) {
    this.timeoutMs = options?.timeoutMs ?? THROTTLE_STORE_TIMEOUT_MS;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottleRecord> {
    const ttlMs = Math.max(1, Math.ceil(finite('ttl', ttl)));
    const max = Math.max(0, Math.floor(finite('limit', limit)));
    const blockMs = Math.max(0, Math.ceil(finite('blockDuration', blockDuration)));
    const [hitKey, blockKey] = throttleKeys(this.prefix, key, throttlerName);
    if (this.clock().getTime() < this.skipUntil) {
      this.heldBack += 1;
      return allowed(ttlMs);
    }
    try {
      if (DISCONNECTED.has(this.redis.status))
        throw new ThrottleStoreDisconnected(this.redis.status);
      const reply = await this.withTimeout(
        this.redis.eval(
          INCREMENT,
          2,
          hitKey,
          blockKey,
          String(ttlMs),
          String(max),
          String(blockMs),
        ),
      );
      return parseReply(reply);
    } catch (error) {
      this.skipUntil = this.clock().getTime() + THROTTLE_BREAKER_MS;
      this.warnUnavailable(error);
      return allowed(ttlMs);
    }
  }

  /**
   * The command keeps running if it loses the race; its late outcome is ignored. The timeout
   * rejects one turn of the event loop late, so under event-loop lag a reply that has already
   * arrived (socket reads run after timers) still wins.
   */
  private async withTimeout<T>(command: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => setImmediate(() => reject(new ThrottleStoreTimeout(this.timeoutMs))),
        this.timeoutMs,
      );
    });
    try {
      return await Promise.race([command, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Error class only: an ioredis message can name hosts. */
  private warnUnavailable(error: unknown): void {
    const now = this.clock().getTime();
    if (now < this.warnAfter) {
      this.heldBack += 1;
      return;
    }
    const name = error instanceof Error ? error.name : typeof error;
    const more =
      this.heldBack > 0 ? `; ${this.heldBack} more allowed unchecked since the last warning` : '';
    this.logger.warn(
      `Rate-limit store unavailable (${name}): requests are allowed without the per-IP limit${more}`,
    );
    this.warnAfter = now + THROTTLE_WARN_EVERY_MS;
    this.heldBack = 0;
  }
}
