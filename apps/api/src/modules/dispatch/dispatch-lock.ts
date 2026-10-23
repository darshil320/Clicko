import { Inject, Injectable } from '@nestjs/common';
import { type LockResult, RedisLocks } from '../../infra/queues/redis-lock';
import { DISPATCH_CONFIG } from './dispatch.config';

export type { LockResult } from '../../infra/queues/redis-lock';

/**
 * ADR-0010 accept step 1: `SET dispatch:booking:{id} {attemptId} NX PX 15000`. The fast path —
 * concurrent accepts get 409 at once. Correctness never depends on it: the booking row lock and
 * the Postgres EXCLUDE constraint are the guarantee (Invariant 8), so a Redis outage degrades to
 * UNAVAILABLE and the accept carries on through Postgres alone.
 */
@Injectable()
export class DispatchLock {
  constructor(@Inject(RedisLocks) private readonly locks: RedisLocks) {}

  acquire(bookingId: string, token: string): Promise<LockResult> {
    return this.locks.acquire(`dispatch:booking:${bookingId}`, token, DISPATCH_CONFIG.acceptLockMs);
  }

  release(bookingId: string, token: string): Promise<void> {
    return this.locks.release(`dispatch:booking:${bookingId}`, token);
  }
}
