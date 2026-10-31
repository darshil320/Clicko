import { describe, expect, it, vi } from 'vitest';
import type { RedisLocks } from '../../../infra/queues/redis-lock';
import { AuthHoldsService, HOLD_LOCK_MS } from '../auth-holds.service';

describe('the hold lease outlives a release (audit L5)', () => {
  it('is at least 60 s: a release makes up to three 10 s gateway calls plus the database', async () => {
    expect(HOLD_LOCK_MS).toBeGreaterThanOrEqual(60_000);
    const locks = {
      acquire: vi.fn(async () => 'ACQUIRED' as const),
      release: vi.fn(async () => {}),
    };
    const holds = new AuthHoldsService(
      {} as never,
      {} as never,
      {} as never,
      locks as unknown as RedisLocks,
      {} as never,
      () => new Date(),
    );
    await holds.withLock('pay-1', async () => 'done');
    expect(locks.acquire).toHaveBeenCalledWith('payment:pay-1', expect.any(String), HOLD_LOCK_MS);
  });
});
