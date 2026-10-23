import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { IDEMPOTENCY_POLICY, IdempotencyStore } from '../idempotency.store';

const T0 = new Date('2026-11-10T06:30:00.000Z');
const later = (ms: number) => new Date(T0.getTime() + ms);

describe.runIf(TEST_DATABASE_URL)('IdempotencyStore in Postgres', () => {
  let db: ScratchDb;
  let store: IdempotencyStore;

  beforeAll(async () => {
    db = await createScratchDb();
    store = new IdempotencyStore(db.sql);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  const claim = (key: string, hash = 'h1', now = T0, scope = 'POST /bookings') =>
    store.claim({ key, scope, requestHash: hash, now });

  it('claims a fresh key, reports it in flight, then replays the stored response', async () => {
    expect(await claim('u:k1')).toEqual({ kind: 'CLAIMED' });
    expect(await claim('u:k1')).toEqual({ kind: 'IN_FLIGHT' });
    await store.complete('u:k1', 201, { success: true, data: { id: 'b1' }, error: null }, T0);
    expect(await claim('u:k1')).toEqual({
      kind: 'REPLAY',
      status: 201,
      body: { success: true, data: { id: 'b1' }, error: null },
    });
  });

  it('refuses the same key for a different body or route', async () => {
    await claim('u:k2', 'h1');
    expect(await claim('u:k2', 'h2')).toEqual({ kind: 'MISMATCH' });
    expect(await claim('u:k2', 'h1', T0, 'POST /bookings/:id/pay')).toEqual({ kind: 'MISMATCH' });
  });

  it('frees a released key for a retry', async () => {
    await claim('u:k3');
    await store.release('u:k3');
    expect(await claim('u:k3')).toEqual({ kind: 'CLAIMED' });
  });

  it('never releases a completed key', async () => {
    await claim('u:k4');
    await store.complete('u:k4', 200, { ok: 1 }, T0);
    await store.release('u:k4');
    expect((await claim('u:k4')).kind).toBe('REPLAY');
  });

  it('lets an expired key be claimed again', async () => {
    await claim('u:k5');
    await store.complete('u:k5', 200, { ok: 1 }, T0);
    expect(await claim('u:k5', 'other', later(IDEMPOTENCY_POLICY.ttlMs + 1))).toEqual({
      kind: 'CLAIMED',
    });
  });

  it('recovers a lock abandoned by a crashed request, for the same request only', async () => {
    await claim('u:k6');
    const stale = later(IDEMPOTENCY_POLICY.staleLockMs + 1);
    expect(await claim('u:k6', 'different', stale)).toEqual({ kind: 'MISMATCH' });
    expect(await claim('u:k6', 'h1', stale)).toEqual({ kind: 'CLAIMED' });
  });
});
