import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { appendDomainEvent } from '../outbox';
import {
  backoffMs,
  CLAIM_LEASE_MS,
  DELIVERY_TIMEOUT_MS,
  MAX_PUBLISH_ATTEMPTS,
  OutboxPublisher,
  TICK_DEADLINE_MS,
} from '../outbox-publisher';
import { OutboxSubscribers, type PublishedEvent } from '../outbox-subscribers';

const NOW = new Date('2026-11-10T06:30:00.000Z');

/** The real publisher with a delivery time limit a test can wait out. */
class QuickPublisher extends OutboxPublisher {
  protected override readonly deliveryTimeoutMs = 50;
}

describe.runIf(TEST_DATABASE_URL)('OutboxPublisher in Postgres', () => {
  let db: ScratchDb;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  beforeEach(async () => {
    await db.sql`DELETE FROM domain_events`;
  });

  async function append(eventType: string, payload: Record<string, string> = {}): Promise<string> {
    const aggregateId = randomUUID();
    await db.sql.begin((tx) =>
      appendDomainEvent(tx, {
        eventType,
        aggregateKind: 'test',
        aggregateId,
        payload,
        occurredAt: NOW,
      }),
    );
    return aggregateId;
  }

  const rows = () =>
    db.sql<
      {
        event_type: string;
        published_at: Date | null;
        publish_attempts: number;
        last_error: string | null;
      }[]
    >`SELECT event_type, published_at, publish_attempts, last_error FROM domain_events ORDER BY id`;

  it('routes each event to its subscribers in id order, then marks it published', async () => {
    const subs = new OutboxSubscribers();
    const seen: string[] = [];
    subs.subscribe('test.a', 'first', async (e) => {
      seen.push(`first:${e.eventType}:${e.payload.n}`);
    });
    subs.subscribe('test.a', 'second', async (e) => {
      seen.push(`second:${e.eventType}:${e.payload.n}`);
    });
    subs.subscribe('test.b', 'only-b', async (e) => {
      seen.push(`b:${e.payload.n}`);
    });
    await append('test.a', { n: '1' });
    await append('test.b', { n: '2' });
    await append('test.a', { n: '3' });

    const result = await new OutboxPublisher(db.sql, subs, () => NOW).tick();

    expect(result).toEqual({ published: 3, failed: 0 });
    expect(seen).toEqual([
      'first:test.a:1',
      'second:test.a:1',
      'b:2',
      'first:test.a:3',
      'second:test.a:3',
    ]);
    expect((await rows()).every((r) => r.published_at?.getTime() === NOW.getTime())).toBe(true);
  });

  it('marks an event nobody subscribes to as published', async () => {
    await append('test.nobody');
    const result = await new OutboxPublisher(db.sql, new OutboxSubscribers(), () => NOW).tick();
    expect(result).toEqual({ published: 1, failed: 0 });
  });

  it('records a failing subscriber (error name only), keeps going, and retries after a backoff', async () => {
    const subs = new OutboxSubscribers();
    let failures = 1;
    const delivered: string[] = [];
    subs.subscribe('test.flaky', 'flaky', async (e: PublishedEvent) => {
      if (failures > 0) {
        failures -= 1;
        throw new TypeError('downstream said +919876543210 is unknown');
      }
      delivered.push(e.eventId);
    });
    subs.subscribe('test.ok', 'ok', async (e) => {
      delivered.push(e.eventType);
    });
    await append('test.flaky');
    await append('test.ok');
    let now = NOW;
    const publisher = new OutboxPublisher(db.sql, subs, () => now);

    expect(await publisher.tick()).toEqual({ published: 1, failed: 1 });
    const [flaky, ok] = await rows();
    expect(flaky).toMatchObject({
      published_at: null,
      publish_attempts: 1,
      last_error: 'flaky: TypeError',
    });
    expect(ok?.published_at).not.toBeNull();

    expect(await publisher.tick()).toEqual({ published: 0, failed: 0 });
    now = new Date(NOW.getTime() + backoffMs(1));
    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    expect(delivered).toHaveLength(2);
    expect((await rows())[0]?.published_at).not.toBeNull();
  });

  it('backs off exponentially from 2 s to a 15-minute ceiling', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffMs(10)).toBe(900_000);
    expect(backoffMs(49)).toBe(900_000);
  });

  it(`dead-letters after ${MAX_PUBLISH_ATTEMPTS} failures with an ops.dead_letter event`, async () => {
    const subs = new OutboxSubscribers();
    let calls = 0;
    subs.subscribe('test.poison', 'poison', async () => {
      calls += 1;
      throw new Error('always fails');
    });
    const aggregateId = await append('test.poison');
    await db.sql`UPDATE domain_events SET publish_attempts = ${MAX_PUBLISH_ATTEMPTS - 1}`;
    const publisher = new OutboxPublisher(db.sql, subs, () => NOW);
    expect(await publisher.tick()).toEqual({ published: 0, failed: 1 });
    expect(calls).toBe(1);
    const [letter] = await db.sql<
      { payload: Record<string, unknown>; published_at: Date | null }[]
    >`
      SELECT payload, published_at FROM domain_events WHERE event_type = 'ops.dead_letter'`;
    expect(letter?.payload).toMatchObject({
      event_type: 'test.poison',
      aggregate_id: aggregateId,
      subscriber: 'poison',
      attempts: MAX_PUBLISH_ATTEMPTS,
    });
    const later = new OutboxPublisher(db.sql, subs, () => new Date(NOW.getTime() + 86_400_000));
    // Only the dead letter itself is delivered; the poison event is never retried.
    expect(await later.tick()).toEqual({ published: 1, failed: 0 });
    expect(calls).toBe(1);
  });

  it('two concurrent ticks never deliver the same event twice (FOR UPDATE SKIP LOCKED)', async () => {
    const subs = new OutboxSubscribers();
    const delivered: string[] = [];
    subs.subscribe('test.slow', 'slow', async (e) => {
      await new Promise((resolve) => setImmediate(resolve));
      delivered.push(e.eventId);
    });
    for (let i = 0; i < 6; i++) await append('test.slow');
    const a = new OutboxPublisher(db.sql, subs, () => NOW);
    const b = new OutboxPublisher(db.sql, subs, () => NOW);
    const [ra, rb] = await Promise.all([a.tick(), b.tick()]);
    expect(ra.published + rb.published).toBe(6);
    expect(new Set(delivered).size).toBe(delivered.length);
    expect(delivered).toHaveLength(6);
  });

  /** A promise plus its resolver: lets a test hold a subscriber mid-delivery. */
  function gate(): { readonly wait: Promise<void>; readonly open: () => void } {
    let open = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  it('a slow subscriber holds no row lock and does not block other ticks', async () => {
    const subs = new OutboxSubscribers();
    const held = gate();
    const entered = gate();
    const delivered: string[] = [];
    subs.subscribe('test.slow', 'slow', async (e) => {
      entered.open();
      await held.wait;
      delivered.push(e.eventType);
    });
    subs.subscribe('test.fast', 'fast', async (e) => {
      delivered.push(e.eventType);
    });
    await append('test.slow');
    const slowTick = new OutboxPublisher(db.sql, subs, () => NOW).tick();
    await entered.wait;

    // While the slow subscriber runs: no open transaction locks the claimed row …
    const locked = await db.sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '500ms'`;
      return tx`SELECT id FROM domain_events WHERE event_type = 'test.slow' FOR UPDATE NOWAIT`;
    });
    expect(locked).toHaveLength(1);
    // … and another tick delivers a newer event without re-delivering the claimed one.
    await append('test.fast');
    expect(await new OutboxPublisher(db.sql, subs, () => NOW).tick()).toEqual({
      published: 1,
      failed: 0,
    });
    expect(delivered).toEqual(['test.fast']);

    held.open();
    expect(await slowTick).toEqual({ published: 1, failed: 0 });
    expect(delivered).toEqual(['test.fast', 'test.slow']);
    expect((await rows()).every((r) => r.published_at !== null)).toBe(true);
  });

  it('redelivers a claim whose tick died once the lease runs out (at-least-once)', async () => {
    const subs = new OutboxSubscribers();
    const held = gate();
    const entered = gate();
    let calls = 0;
    subs.subscribe('test.crash', 'crash', async () => {
      calls += 1;
      if (calls === 1) {
        entered.open();
        await held.wait; // the "crashed" tick never gets past here during the test
      }
    });
    await append('test.crash');
    const dying = new OutboxPublisher(db.sql, subs, () => NOW).tick();
    await entered.wait;

    const justBefore = new Date(NOW.getTime() + CLAIM_LEASE_MS - 1);
    expect(await new OutboxPublisher(db.sql, subs, () => justBefore).tick()).toEqual({
      published: 0,
      failed: 0,
    });
    const afterLease = new Date(NOW.getTime() + CLAIM_LEASE_MS);
    expect(await new OutboxPublisher(db.sql, subs, () => afterLease).tick()).toEqual({
      published: 1,
      failed: 0,
    });
    expect(calls).toBe(2);

    held.open();
    await dying; // the late tick's mark is a no-op on an already-published event
    expect((await rows())[0]?.published_at).not.toBeNull();
  });

  it('hands unstarted claims back once a tick passes its deadline', async () => {
    const subs = new OutboxSubscribers();
    let now = NOW;
    const seen: string[] = [];
    subs.subscribe('test.long', 'long', async (e) => {
      seen.push(String(e.payload.n));
      now = new Date(now.getTime() + TICK_DEADLINE_MS); // each delivery eats the whole budget
    });
    for (const n of ['1', '2', '3']) await append('test.long', { n });
    const publisher = new OutboxPublisher(db.sql, subs, () => now);

    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    const left = await db.sql<{ next_attempt_at: Date | null }[]>`
      SELECT next_attempt_at FROM domain_events WHERE published_at IS NULL ORDER BY id`;
    expect(left.map((r) => r.next_attempt_at)).toEqual([null, null]);

    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    expect(seen).toEqual(['1', '2', '3']);
  });

  /** Everything a settle could touch. */
  const state = async () => {
    const [row] = await db.sql<
      {
        published_at: Date | null;
        publish_attempts: number;
        last_error: string | null;
        next_attempt_at: Date | null;
        claim_token: string | null;
      }[]
    >`SELECT published_at, publish_attempts, last_error, next_attempt_at, claim_token
        FROM domain_events ORDER BY id LIMIT 1`;
    if (!row) throw new Error('no event');
    return row;
  };

  it('a delivery past its time limit fails as DeliveryTimeout, is aborted, and retries on backoff once its handler returns', async () => {
    // Well under the lease: the last delivery a tick starts still settles inside it.
    expect(TICK_DEADLINE_MS + DELIVERY_TIMEOUT_MS).toBeLessThan(CLAIM_LEASE_MS);
    const subs = new OutboxSubscribers();
    const never = gate();
    let signal: AbortSignal | undefined;
    let calls = 0;
    let laterCalls = 0;
    subs.subscribe('test.hang', 'hang', async (_e, s) => {
      calls += 1;
      if (calls === 1) {
        signal = s;
        await never.wait; // hangs past the limit
      }
    });
    subs.subscribe('test.hang', 'later', async () => {
      laterCalls += 1;
    });
    await append('test.hang');
    let now = NOW;
    const publisher = new QuickPublisher(db.sql, subs, () => now);

    expect(await publisher.tick()).toEqual({ published: 0, failed: 1 });
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as Error | undefined)?.name).toBe('DeliveryTimeout');
    expect(laterCalls).toBe(0); // the event's later subscribers wait for the retry
    const held = await state();
    expect(held).toMatchObject({
      published_at: null,
      publish_attempts: 1,
      last_error: 'hang: DeliveryTimeout',
      // Its handler is still running: the tick keeps the claim for a lease, not a 2 s backoff.
      next_attempt_at: new Date(NOW.getTime() + CLAIM_LEASE_MS),
    });
    expect(held.claim_token).not.toBeNull();

    now = new Date(NOW.getTime() + backoffMs(1));
    expect(await publisher.tick()).toEqual({ published: 0, failed: 0 }); // no second copy
    expect(calls).toBe(1);

    // The abandoned handler returns: the event is handed back and retries on its backoff.
    never.open();
    await vi.waitFor(async () => expect((await state()).claim_token).toBeNull());
    const retryAt = new Date(now.getTime() + backoffMs(1));
    expect((await state()).next_attempt_at).toEqual(retryAt);
    expect(laterCalls).toBe(0); // the abandoned delivery started no later subscriber
    now = retryAt;
    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    expect([calls, laterCalls]).toEqual([2, 1]);
  });

  it('a delivery whose handler never returns is retried once the lease has passed', async () => {
    const subs = new OutboxSubscribers();
    const never = gate();
    let calls = 0;
    subs.subscribe('test.stuck', 'stuck', async () => {
      calls += 1;
      if (calls === 1) await never.wait;
    });
    await append('test.stuck');
    let now = NOW;
    const publisher = new QuickPublisher(db.sql, subs, () => now);
    expect(await publisher.tick()).toEqual({ published: 0, failed: 1 });

    now = new Date(NOW.getTime() + CLAIM_LEASE_MS - 1);
    expect(await publisher.tick()).toEqual({ published: 0, failed: 0 });
    now = new Date(NOW.getTime() + CLAIM_LEASE_MS);
    expect(await publisher.tick()).toEqual({ published: 1, failed: 0 });
    expect(calls).toBe(2);

    // When the first handler finally returns, its hand-back finds the claim gone: no change.
    const published = await state();
    never.open();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await state()).toEqual(published);
  });

  it('a timed-out delivery at the attempt limit is dead-lettered, not held', async () => {
    const subs = new OutboxSubscribers();
    const never = gate();
    subs.subscribe('test.hang', 'hang', async () => {
      await never.wait;
    });
    await append('test.hang');
    await db.sql`UPDATE domain_events SET publish_attempts = ${MAX_PUBLISH_ATTEMPTS - 1}`;
    expect(await new QuickPublisher(db.sql, subs, () => NOW).tick()).toEqual({
      published: 0,
      failed: 1,
    });
    const [poisoned] = await db.sql<{ next_attempt_at: Date | null; claim_token: string | null }[]>`
      SELECT next_attempt_at::text AS next_attempt_at, claim_token FROM domain_events
      WHERE event_type = 'test.hang'`;
    expect(poisoned).toEqual({ next_attempt_at: 'infinity', claim_token: null });
    never.open();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [after] = await db.sql<{ next_attempt_at: string }[]>`
      SELECT next_attempt_at::text AS next_attempt_at FROM domain_events
      WHERE event_type = 'test.hang'`;
    expect(after?.next_attempt_at).toBe('infinity'); // never resurrected by the hand-back
  });

  it('a delivery inside its time limit is never aborted', async () => {
    const subs = new OutboxSubscribers();
    let signal: AbortSignal | undefined;
    subs.subscribe('test.quick', 'quick', async (_e, s) => {
      signal = s;
    });
    await append('test.quick');
    expect(await new QuickPublisher(db.sql, subs, () => NOW).tick()).toEqual({
      published: 1,
      failed: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 80)); // past the 50 ms limit
    expect(signal?.aborted).toBe(false);
  });

  it('claims carry a token, and a tick that lost its claim cannot mark the event published', async () => {
    const subs = new OutboxSubscribers();
    const held = gate();
    const entered = gate();
    let calls = 0;
    subs.subscribe('test.stale', 'stale', async () => {
      calls += 1;
      if (calls === 1) {
        entered.open();
        await held.wait; // outlives the lease
        return;
      }
      throw new TypeError('the newer claim fails');
    });
    await append('test.stale');
    const stale = new OutboxPublisher(db.sql, subs, () => NOW).tick();
    await entered.wait;
    const claimed = await state();
    expect(claimed.claim_token).toMatch(/^[0-9a-f-]{36}$/);
    expect(claimed.next_attempt_at).toEqual(new Date(NOW.getTime() + CLAIM_LEASE_MS));

    const afterLease = new Date(NOW.getTime() + CLAIM_LEASE_MS);
    expect(await new OutboxPublisher(db.sql, subs, () => afterLease).tick()).toEqual({
      published: 0,
      failed: 1,
    });
    const settled = await state();
    expect(settled).toMatchObject({
      published_at: null,
      publish_attempts: 1,
      last_error: 'stale: TypeError',
      next_attempt_at: new Date(afterLease.getTime() + backoffMs(1)),
      claim_token: null,
    });

    held.open();
    expect(await stale).toEqual({ published: 0, failed: 0 });
    expect(await state()).toEqual(settled); // the late success changed nothing
  });

  it("a tick that lost its claim cannot record a failure over the newer tick's lease", async () => {
    const subs = new OutboxSubscribers();
    const heldFirst = gate();
    const enteredFirst = gate();
    const heldSecond = gate();
    const enteredSecond = gate();
    let calls = 0;
    subs.subscribe('test.stale', 'stale', async () => {
      calls += 1;
      if (calls === 1) {
        enteredFirst.open();
        await heldFirst.wait;
        throw new TypeError('the stale delivery fails late');
      }
      enteredSecond.open();
      await heldSecond.wait;
    });
    await append('test.stale');
    const stale = new OutboxPublisher(db.sql, subs, () => NOW).tick();
    await enteredFirst.wait;
    const afterLease = new Date(NOW.getTime() + CLAIM_LEASE_MS);
    const fresh = new OutboxPublisher(db.sql, subs, () => afterLease).tick();
    await enteredSecond.wait;
    const newerClaim = await state();
    expect(newerClaim).toMatchObject({
      publish_attempts: 0,
      next_attempt_at: new Date(afterLease.getTime() + CLAIM_LEASE_MS),
    });
    expect(newerClaim.claim_token).not.toBeNull();

    heldFirst.open();
    expect(await stale).toEqual({ published: 0, failed: 0 });
    expect(await state()).toEqual(newerClaim); // lease, token and attempts untouched

    heldSecond.open();
    expect(await fresh).toEqual({ published: 1, failed: 0 });
    expect(await state()).toMatchObject({ publish_attempts: 0, claim_token: null });
    expect((await state()).published_at).not.toBeNull();
  });

  it('refuses a second subscriber with the same name for one event type', () => {
    const subs = new OutboxSubscribers();
    subs.subscribe('test.dup', 'one', async () => {});
    expect(() => subs.subscribe('test.dup', 'one', async () => {})).toThrow(/already/);
  });
});
