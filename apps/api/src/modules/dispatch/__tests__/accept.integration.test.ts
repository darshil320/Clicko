import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertUser } from '../../../test-support/booking-fixtures';
import {
  attemptsOf,
  bookingStatus,
  confirmedBooking,
  drainOutbox,
  eventsOf,
  expectedPayout,
  roundsOf,
} from '../../../test-support/dispatch-fixtures';
import { type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { RedispatchService } from '../redispatch.service';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

describe.runIf(TEST_DATABASE_URL)('accepting offers (first accept wins, no double booking)', () => {
  let e2e: E2eApp;
  let userId: string;
  const id: Record<string, string> = {};
  const token: Record<string, string> = {};
  let seq = 0;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    userId = await insertUser(e2e.db.sql, '+919811100002');
    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    const spots: ReadonlyArray<[string, number, number, boolean]> = [
      ['q1', 2, 0, false],
      ['q2', 3, 90, false],
      ['q3', 5, 180, false],
      ['q4', 9, 270, true],
    ];
    for (const [key, km, bearing, emergency] of spots) {
      const phone = proPhone(100 + ++seq);
      id[key] = await insertPhotographer(e2e.db.sql, {
        phone,
        name: `Photographer ${key.toUpperCase()}`,
        km,
        bearing,
        acceptsEmergency: emergency,
        categories: food,
      });
      token[key] = await e2e.proLogin(phone);
    }
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const key = (label: string) => `${label}-${String(++seq).padStart(4, '0')}`;
  const accept = (who: string, attemptId: string) =>
    e2e.call('POST', `/pro/offers/${attemptId}/accept`, {
      token: token[who],
      idempotencyKey: key('accept'),
    });
  const offerFor = async (bookingId: string, who: string) => {
    const a = (await attemptsOf(e2e, bookingId)).find(
      (x) => x.photographer_id === id[who] && x.outcome === 'PENDING',
    );
    if (!a) throw new Error(`no pending offer for ${who}`);
    return a.id;
  };
  const penaltiesOf = (photographerId: string, bookingId: string) =>
    e2e.db.sql<{ kind: string; severity: number; note: string }[]>`
      SELECT kind, severity, note FROM photographer_penalties
      WHERE photographer_id = ${photographerId} AND booking_id = ${bookingId}`;
  const reviewReasons = async (bookingId: string) =>
    (
      await e2e.db.sql<{ reason: string }[]>`
        SELECT payload->>'reason' AS reason FROM domain_events
        WHERE event_type = 'payment.needs_review' AND payload->>'booking_id' = ${bookingId}`
    ).map((r) => r.reason);
  const dispatched = async (start: Date) => {
    const { bookingId } = await confirmedBooking(e2e, userId, start);
    await drainOutbox(e2e);
    return bookingId;
  };

  it('lists an offer with payout and approximate area only — no address, no phone', async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 4 * DAY));
    const res = await e2e.call('GET', '/pro/offers', { token: token.q1 });
    expect(res.status).toBe(200);
    const offer = res.json.data.find((o: { bookingId: string }) => o.bookingId === bookingId);
    expect(offer).toMatchObject({
      payoutPaise: Number(await expectedPayout(e2e, bookingId)),
      area: { pincode: '395007', cityName: 'Surat' },
      clientDisplayName: 'Ananya I.',
      isBroadcast: false,
      categoryCode: 'FOOD',
    });
    const text = JSON.stringify(res.json);
    expect(text).not.toContain('Ghod Dod');
    expect(text).not.toContain('+9198765');
  });

  it('two photographers accept at once: exactly one ASSIGNED, the other 409 ALREADY_TAKEN', async () => {
    const start = new Date(NOW.getTime() + 5 * DAY);
    const bookingId = await dispatched(start);
    const [o1, o2] = [await offerFor(bookingId, 'q1'), await offerFor(bookingId, 'q2')];
    const [a, b] = await Promise.all([accept('q1', o1), accept('q2', o2)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    // Mid-flight: the Redis lock (ACCEPT_IN_PROGRESS); already done: the attempt lost (ALREADY_TAKEN).
    expect(['ACCEPT_IN_PROGRESS', 'ALREADY_TAKEN']).toContain(loser.json.error.code);
    // The accept response carries IDs only — safe to replay (ADR-0012).
    expect(winner.json.data).toEqual({
      attemptId: expect.any(String),
      assignmentId: expect.any(String),
      bookingId,
      status: 'ASSIGNED',
    });
    expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');

    const assignments = await e2e.db.sql<
      { photographer_id: string; blocked_from: Date; blocked_until: Date; status: string }[]
    >`SELECT photographer_id, blocked_from, blocked_until, status FROM assignments WHERE booking_id = ${bookingId}`;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      status: 'ASSIGNED',
      blocked_from: new Date(start.getTime() - 90 * MIN),
      blocked_until: new Date(start.getTime() + 2 * HOUR + 90 * MIN),
    });
    const outcomes = (await attemptsOf(e2e, bookingId)).map((x) => x.outcome).sort();
    expect(outcomes).toEqual(['ACCEPTED', 'LOST_RACE', 'LOST_RACE']);
    expect((await roundsOf(e2e, bookingId))[0]?.outcome).toBe('FILLED');
    expect(await eventsOf(e2e, bookingId)).toContain('booking.assigned');

    const winnerKey = assignments[0]?.photographer_id === id.q1 ? 'q1' : 'q2';
    const mine = await e2e.call('GET', '/pro/assignments', { token: token[winnerKey] });
    const assigned = mine.json.data.find((x: { bookingId: string }) => x.bookingId === bookingId);
    expect(assigned.venue.address).toBe('12 Ghod Dod Road, Surat');
    const q3Offers = await e2e.call('GET', '/pro/offers', { token: token.q3 });
    expect(q3Offers.json.data.map((o: { bookingId: string }) => o.bookingId)).not.toContain(
      bookingId,
    );
  });

  it("refuses an expired offer (409) and someone else's offer (404, never 403)", async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 6 * DAY));
    const attemptId = await offerFor(bookingId, 'q1');
    const other = await accept('q2', attemptId);
    expect(other.status).toBe(404);
    expect(other.json.error.code).toBe('OFFER_NOT_FOUND');
    e2e.advance(121_000);
    const late = await accept('q1', attemptId);
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('OFFER_EXPIRED');
    await e2e.runDueJobs();
  });

  it('keeps pro routes to photographers: 401 without a session, 403 for a client session', async () => {
    expect((await e2e.call('GET', '/pro/offers')).status).toBe(401);
    const client = await e2e.login('+919811100099');
    const res = await e2e.call('GET', '/pro/offers', { token: client });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe('PHOTOGRAPHERS_ONLY');
  });

  it('a paused photographer is refused at once, even with a live access token (403 ACCOUNT_INACTIVE)', async () => {
    await e2e.db.sql`UPDATE photographers SET status = 'PAUSED' WHERE id = ${id.q3 ?? ''}`;
    try {
      const res = await e2e.call('GET', '/pro/offers', { token: token.q3 });
      expect(res.status).toBe(403);
      expect(res.json.error.code).toBe('ACCOUNT_INACTIVE');
    } finally {
      await e2e.db.sql`UPDATE photographers SET status = 'ACTIVE' WHERE id = ${id.q3 ?? ''}`;
    }
  });

  it('a personal block added after the offer is caught inside the accept (409 SLOT_CONFLICT)', async () => {
    const start = new Date(NOW.getTime() + 7 * DAY);
    const bookingId = await dispatched(start);
    const attemptId = await offerFor(bookingId, 'q2');
    await e2e.db.sql`
      INSERT INTO photographer_blocks (photographer_id, blocked_from, blocked_until, reason)
      VALUES (${id.q2 ?? ''}, ${start}, ${new Date(start.getTime() + HOUR)}, 'dentist')`;
    const res = await accept('q2', attemptId);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('SLOT_CONFLICT');
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
  });

  it('the EXCLUDE constraint refuses a double booking across two bookings (409 SLOT_CONFLICT)', async () => {
    const day = NOW.getTime() + 8 * DAY;
    const x = await dispatched(new Date(day));
    const y = await dispatched(new Date(day + 2 * HOUR));
    const offerY = await offerFor(y, 'q1');
    expect((await accept('q1', await offerFor(x, 'q1'))).status).toBe(200);
    const clash = await accept('q1', offerY);
    expect(clash.status).toBe(409);
    expect(clash.json.error.code).toBe('SLOT_CONFLICT');
    expect(await bookingStatus(e2e, y)).toBe('DISPATCHING');
    const mine = (await attemptsOf(e2e, y)).find((a) => a.id === offerY);
    expect(mine).toMatchObject({ outcome: 'CANCELLED', decline_reason: 'SLOT_CONFLICT' });
    expect(await e2e.db.sql`SELECT 1 FROM assignments WHERE booking_id = ${y}`).toHaveLength(0);
  });

  it('declines with a reason; declining again is harmless', async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 9 * DAY));
    const attemptId = await offerFor(bookingId, 'q2');
    const call = () =>
      e2e.call('POST', `/pro/offers/${attemptId}/decline`, {
        token: token.q2,
        body: { reason: 'Already busy' },
      });
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.json.data).toEqual({ attemptId, outcome: 'DECLINED' });
    expect((await call()).status).toBe(200);
    const row = (await attemptsOf(e2e, bookingId)).find((a) => a.id === attemptId);
    expect(row).toMatchObject({ outcome: 'DECLINED', decline_reason: 'Already busy' });
  });

  it('a photographer who cancels after accepting sends the booking back to dispatch, without them', async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 10 * DAY));
    const accepted = await accept('q1', await offerFor(bookingId, 'q1'));
    const assignmentId = accepted.json.data.assignmentId as string;
    const cancel = await e2e.call('POST', `/pro/assignments/${assignmentId}/cancel`, {
      token: token.q1,
      idempotencyKey: key('cancel'),
      body: { reason: 'Bike broke down' },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json.data).toEqual({ assignmentId, status: 'RELEASED' });
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    expect(await eventsOf(e2e, bookingId)).toContain('booking.redispatching');
    const [old] = await e2e.db.sql<{ status: string; release_reason: string }[]>`
      SELECT status, release_reason FROM assignments WHERE id = ${assignmentId}`;
    expect(old).toEqual({ status: 'RELEASED', release_reason: 'Bike broke down' });
    expect(await penaltiesOf(id.q1 ?? '', bookingId)).toEqual([
      { kind: 'CONDUCT', severity: 1, note: 'late cancellation: Bike broke down' },
    ]);

    const rounds = await roundsOf(e2e, bookingId);
    expect(rounds.map((r) => [r.wave, r.outcome])).toEqual([
      [1, 'FILLED'],
      [2, null],
    ]);
    const fresh = (await attemptsOf(e2e, bookingId)).filter((a) => a.wave === 2);
    expect(fresh.map((a) => a.photographer_id)).not.toContain(id.q1);
    expect(fresh.length).toBeGreaterThan(0);

    const replacement = await accept('q2', await offerFor(bookingId, 'q2'));
    expect(replacement.status).toBe(200);
    const [row] = await e2e.db.sql<{ is_replacement: boolean; replaced_assignment_id: string }[]>`
      SELECT is_replacement, replaced_assignment_id FROM assignments
      WHERE booking_id = ${bookingId} AND status = 'ASSIGNED'`;
    expect(row).toEqual({ is_replacement: true, replaced_assignment_id: assignmentId });

    const again = await e2e.call('POST', `/pro/assignments/${assignmentId}/cancel`, {
      token: token.q1,
      idempotencyKey: key('cancel-again'),
      body: { reason: 'Bike broke down' },
    });
    expect(again.status).toBe(409);
  });

  it('a no-show re-broadcasts at 2.0× the base share; unfilled, it ends PRO_NO_SHOW (ADR-0012 D5/D6)', async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 12 * DAY));
    const accepted = await accept('q1', await offerFor(bookingId, 'q1'));
    await e2e
      .get(RedispatchService)
      .redispatch(bookingId, 'No check-in by scheduled start + 15 min', 'NO_SHOW');
    const [abandoned] = await e2e.db.sql<{ status: string }[]>`
      SELECT status FROM assignments WHERE id = ${accepted.json.data.assignmentId}`;
    expect(abandoned?.status).toBe('ABANDONED');
    expect(await penaltiesOf(id.q1 ?? '', bookingId)).toEqual([
      { kind: 'NO_SHOW', severity: 1, note: 'no-show: No check-in by scheduled start + 15 min' },
    ]);
    const rounds = await roundsOf(e2e, bookingId);
    expect(rounds[1]).toMatchObject({ wave: 2, is_broadcast: true, window_seconds: 600 });
    const offers = (await attemptsOf(e2e, bookingId)).filter((a) => a.wave === 2);
    expect(offers.map((a) => a.photographer_id)).toEqual([id.q4]);
    // No add-ons here: incentive = 2 × base share + travel = 2 × (payout − travel) + travel.
    const [snap] = await e2e.db.sql<{ payout: string; travel: string }[]>`
      SELECT expected_payout_paise AS payout, travel_amount_paise AS travel
      FROM booking_price_snapshots WHERE booking_id = ${bookingId} AND sequence = 1`;
    const travel = BigInt(snap?.travel ?? '0');
    expect(offers[0]?.offered_payout_paise).toBe(
      String(2n * (BigInt(snap?.payout ?? '0') - travel) + travel),
    );

    e2e.advance(600_000);
    await e2e.runDueJobs();
    expect(await bookingStatus(e2e, bookingId)).toBe('PRO_NO_SHOW');
    await drainOutbox(e2e);
    expect(await reviewReasons(bookingId)).toContain('REFUND_DUE_NO_SHOW');
    e2e.advance(-600_000);
  });

  it('a replacement search that finds nobody ends the booking CANCELLED_PRO (ADR-0012 D6)', async () => {
    const bookingId = await dispatched(new Date(NOW.getTime() + 14 * DAY));
    const accepted = await accept('q1', await offerFor(bookingId, 'q1'));
    await e2e.call('POST', `/pro/assignments/${accepted.json.data.assignmentId}/cancel`, {
      token: token.q1,
      idempotencyKey: key('cancel-exhaust'),
      body: { reason: 'Family emergency' },
    });
    for (let i = 0; i < 4 && (await bookingStatus(e2e, bookingId)) === 'DISPATCHING'; i++) {
      for (const a of (await attemptsOf(e2e, bookingId)).filter((x) => x.outcome === 'PENDING')) {
        const who = Object.entries(id).find(([, v]) => v === a.photographer_id)?.[0] ?? '';
        await e2e.call('POST', `/pro/offers/${a.id}/decline`, { token: token[who], body: {} });
      }
    }
    expect(await bookingStatus(e2e, bookingId)).toBe('CANCELLED_PRO');
    const [b] = await e2e.db.sql<{ cancellation_reason: string }[]>`
      SELECT cancellation_reason FROM bookings WHERE id = ${bookingId}`;
    expect(b?.cancellation_reason).toBe('REDISPATCH_UNFILLED');
    expect(await eventsOf(e2e, bookingId)).toContain('dispatch.exhausted');
    await drainOutbox(e2e);
    expect(await reviewReasons(bookingId)).toContain('REFUND_DUE_UNFILLED');
  });
});
