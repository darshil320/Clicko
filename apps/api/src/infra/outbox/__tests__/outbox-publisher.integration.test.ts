import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { appendDomainEvent } from '../outbox';
import { backoffMs, MAX_PUBLISH_ATTEMPTS, OutboxPublisher } from '../outbox-publisher';
import { OutboxSubscribers, type PublishedEvent } from '../outbox-subscribers';

const NOW = new Date('2026-11-10T06:30:00.000Z');

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

  it('refuses a second subscriber with the same name for one event type', () => {
    const subs = new OutboxSubscribers();
    subs.subscribe('test.dup', 'one', async () => {});
    expect(() => subs.subscribe('test.dup', 'one', async () => {})).toThrow(/already/);
  });
});
