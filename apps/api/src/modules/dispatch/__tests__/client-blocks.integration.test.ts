import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendDomainEvent } from '../../../infra/outbox/outbox';
import { insertUser } from '../../../test-support/booking-fixtures';
import {
  attemptsOf,
  bookingStatus,
  confirmedBooking,
  drainOutbox,
  eventsOf,
} from '../../../test-support/dispatch-fixtures';
import { type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { OffersService } from '../offers.service';
import { RedispatchService } from '../redispatch.service';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const DAY = 24 * 60 * 60_000;

/**
 * ADR-0027 D4: a client who blocked a photographer never has a booking offered to them — not in
 * a new search, not through an offer that was already open when they blocked (it is withdrawn,
 * and accepting it is refused), not in a re-dispatch. The block is the client's alone: another
 * client's booking still reaches that photographer.
 */
describe.runIf(TEST_DATABASE_URL)('dispatch honours client blocks (ADR-0027 D4)', () => {
  let e2e: E2eApp;
  const client: Record<string, string> = {};
  const pro: Record<string, string> = {};
  let day = 4;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    for (const [key, n] of [
      ['blocker', 1],
      ['other', 2],
      ['midCascade', 3],
      ['withdrawn', 4],
      ['redispatch', 5],
    ] as const) {
      client[key] = await insertUser(e2e.db.sql, `+91981110010${n}`);
    }
    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    for (const [key, n, km, bearing] of [
      ['near', 41, 1, 0],
      ['mid', 42, 3, 90],
      ['far', 43, 5, 180],
    ] as const) {
      pro[key] = await insertPhotographer(e2e.db.sql, {
        phone: proPhone(n),
        name: key,
        km,
        bearing,
        categories: food,
      });
    }
    await block('blocker', 'near');
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  /** The block row as the safety module stores it; `announce` also emits client_block.added. */
  async function block(who: string, whom: string, announce = false): Promise<void> {
    const userId = client[who] ?? '';
    const photographerId = pro[whom] ?? '';
    await e2e.db.sql.begin(async (tx) => {
      await tx`INSERT INTO client_photographer_blocks (user_id, photographer_id)
               VALUES (${userId}, ${photographerId})`;
      if (announce) {
        await appendDomainEvent(tx, {
          eventType: 'client_block.added',
          aggregateKind: 'user',
          aggregateId: userId,
          occurredAt: e2e.now(),
          payload: { user_id: userId, photographer_id: photographerId },
        });
      }
    });
  }

  const book = async (who: string) => {
    day += 1;
    const { bookingId } = await confirmedBooking(
      e2e,
      client[who] ?? '',
      new Date(NOW.getTime() + day * DAY),
    );
    await drainOutbox(e2e);
    return bookingId;
  };
  const offerTo = async (bookingId: string, whom: string) =>
    (await attemptsOf(e2e, bookingId)).find((a) => a.photographer_id === pro[whom]);
  const offeredIn = async (bookingId: string) =>
    (await attemptsOf(e2e, bookingId)).map((a) => a.photographer_id);
  const attempt = async (id: string) =>
    (
      await e2e.db.sql<{ outcome: string; decline_reason: string | null }[]>`
        SELECT outcome, decline_reason FROM dispatch_attempts WHERE id = ${id}`
    )[0];

  it("never offers the blocking client's booking to the blocked photographer", async () => {
    const bookingId = await book('blocker');
    const offered = await offeredIn(bookingId);
    expect(offered).not.toContain(pro.near);
    expect(offered).toEqual(expect.arrayContaining([pro.mid, pro.far]));
  });

  it("still offers another client's booking to that photographer", async () => {
    expect(await offeredIn(await book('other'))).toContain(pro.near);
  });

  it('an offer open when the client blocked cannot be accepted (checked under the booking lock)', async () => {
    const bookingId = await book('midCascade');
    const offer = await offerTo(bookingId, 'near');
    expect(offer?.outcome).toBe('PENDING');
    await block('midCascade', 'near'); // not yet announced: the accept itself must refuse
    await expect(
      e2e.get(OffersService).accept(pro.near ?? '', offer?.id ?? ''),
    ).rejects.toMatchObject({ response: { code: 'OFFER_CLOSED' } });
    expect(await attempt(offer?.id ?? '')).toEqual({
      outcome: 'CANCELLED',
      decline_reason: 'CLIENT_BLOCKED',
    });
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    expect(await eventsOf(e2e, bookingId)).toContain('dispatch.offer_withdrawn');
    // The rest of the wave can still take it.
    const mid = await offerTo(bookingId, 'mid');
    await e2e.get(OffersService).accept(pro.mid ?? '', mid?.id ?? '');
    expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');
  });

  it("client_block.added withdraws that photographer's open offers on the client's bookings", async () => {
    const bookingId = await book('withdrawn');
    const offer = await offerTo(bookingId, 'near');
    expect(offer?.outcome).toBe('PENDING');
    await block('withdrawn', 'near', true);
    await drainOutbox(e2e);
    expect(await attempt(offer?.id ?? '')).toEqual({
      outcome: 'CANCELLED',
      decline_reason: 'CLIENT_BLOCKED',
    });
    const listed = await e2e.get(OffersService).list(pro.near ?? '');
    expect(listed.map((o) => o.bookingId)).not.toContain(bookingId);
    await expect(
      e2e.get(OffersService).accept(pro.near ?? '', offer?.id ?? ''),
    ).rejects.toMatchObject({ response: { code: 'OFFER_CLOSED' } });
    expect(await eventsOf(e2e, bookingId)).toContain('dispatch.offer_withdrawn');

    // Redelivered: nothing more happens.
    const before = (await eventsOf(e2e, bookingId)).length;
    await e2e.db.sql`UPDATE domain_events SET published_at = NULL
                     WHERE event_type = 'client_block.added' AND aggregate_id = ${client.withdrawn ?? ''}`;
    await drainOutbox(e2e);
    expect((await eventsOf(e2e, bookingId)).length).toBe(before);
  });

  it('a re-dispatch never re-offers the booking to a photographer the client blocked', async () => {
    const bookingId = await book('redispatch');
    const mid = await offerTo(bookingId, 'mid');
    await e2e.get(OffersService).accept(pro.mid ?? '', mid?.id ?? '');
    await block('redispatch', 'near');
    const lastWave = Math.max(...(await attemptsOf(e2e, bookingId)).map((a) => a.wave));
    await e2e
      .get(RedispatchService)
      .redispatch(bookingId, 'Photographer cancelled', 'PRO_CANCELLED');
    await drainOutbox(e2e);
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    const rerun = (await attemptsOf(e2e, bookingId)).filter((a) => a.wave > lastWave);
    expect(rerun.length).toBeGreaterThan(0);
    expect(rerun.map((a) => a.photographer_id)).not.toContain(pro.near);
    expect(rerun.map((a) => a.photographer_id)).toContain(pro.far);
  });
});
