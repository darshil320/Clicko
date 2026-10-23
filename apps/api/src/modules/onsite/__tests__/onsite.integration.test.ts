import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainOutbox } from '../../../test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from '../../../test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  fixAt,
  idemKey,
  insertClient,
  proAction,
  setNow,
  tokenFor,
} from '../../../test-support/onsite-fixtures';
import { insertPhotographer } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * MIN);

/** Chronological, so the shared clock only moves forward through the scenarios. */
const START_X = new Date(NOW.getTime() + 5 * DAY);
const START_Y = new Date(NOW.getTime() + 6 * DAY);
const START_Z = plus(START_Y, 5 * 60); // the photographer's next booking, right after Y's buffer
const START_W = new Date(NOW.getTime() + 7 * DAY);
const START_V = new Date(NOW.getTime() + 8 * DAY);
const START_U = new Date(NOW.getTime() + 9 * DAY);

describe.runIf(TEST_DATABASE_URL)('on-site guards, extensions, waiting, incidents', () => {
  let e2e: E2eApp;
  let userId: string;
  let otherUserId: string;
  let proA: string;
  let proB: string;
  const ids: Record<string, { booking: string; assignment: string }> = {};
  const bookingOf = (which: string): string => {
    const b = ids[which]?.booking;
    if (!b) throw new Error(`no booking ${which}`);
    return b;
  };
  const assignmentOf = (which: string): string => {
    const a = ids[which]?.assignment;
    if (!a) throw new Error(`no assignment ${which}`);
    return a;
  };
  const act = (who: string, which: string, action: string, body?: unknown) =>
    proAction(e2e, who, assignmentOf(which), action, body);
  const clientCall = async (which: string, path: string, asUser = userId) =>
    e2e.call('POST', `/bookings/${bookingOf(which)}/${path}`, {
      token: await tokenFor(e2e, 'USER', asUser),
      idempotencyKey: idemKey(path),
    });
  const bookingRow = async (which: string) =>
    (
      await e2e.db.sql<
        {
          status: string;
          total_paise: string;
          balance_paise: string;
          sla_t0: Date | null;
          actual_check_out: Date | null;
        }[]
      >`SELECT status, total_paise, balance_paise, sla_t0, actual_check_out
        FROM bookings WHERE id = ${bookingOf(which)}`
    )[0];
  const eventKinds = async (which: string) =>
    (
      await e2e.db.sql<{ kind: string; note: string | null }[]>`
        SELECT kind, note FROM assignment_events WHERE assignment_id = ${assignmentOf(which)}
        ORDER BY id`
    ).map((r) => (r.note ? `${r.kind}:${r.note}` : r.kind));

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    proA = await insertPhotographer(e2e.db.sql, {
      phone: '+919825099301',
      km: 3,
      categories: food,
    });
    proB = await insertPhotographer(e2e.db.sql, {
      phone: '+919825099302',
      km: 6,
      categories: food,
    });
    userId = await insertClient(e2e, '+919700000901');
    otherUserId = await insertClient(e2e, '+919700000902');
    for (const [which, start] of [
      ['X', START_X],
      ['Y', START_Y],
      ['Z', START_Z],
      ['W', START_W],
      ['V', START_V],
      ['U', START_U],
    ] as const) {
      const booking = await bookAndPay(e2e, userId, start);
      ids[which] = { booking: booking.id, assignment: await acceptOffer(e2e, proA, booking.id) };
    }
  }, 120_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('booking X: ownership, stage guards, auto en-route, waiting, client non-attendance', () => {
    it("someone else's assignment is 404, like a missing one", async () => {
      setNow(e2e, plus(START_X, -60));
      const res = await act(proB, 'X', 'check-in', fixAt(0.05, 0));
      expect(res.status).toBe(404);
      expect(res.json.error.code).toBe('ASSIGNMENT_NOT_FOUND');
      const detail = await e2e.call('GET', `/pro/assignments/${assignmentOf('X')}`, {
        token: await tokenFor(e2e, 'PHOTOGRAPHER', proB),
      });
      expect(detail.status).toBe(404);
    });

    it('nothing on-site works before a check-in', async () => {
      expect((await act(proA, 'X', 'extensions', { hours: 1 })).json.error.code).toBe(
        'ASSIGNMENT_NOT_ACTIVE',
      );
      const waiting = await act(proA, 'X', 'waiting', {
        minutes: 5,
        note: 'Early',
        ...fixAt(0, 0),
      });
      expect(waiting.json.error.code).toBe('ASSIGNMENT_NOT_ACTIVE');
      expect((await act(proA, 'X', 'start')).json.error.code).toBe('ASSIGNMENT_NOT_ACTIVE');
      const out = await act(proA, 'X', 'check-out', { ...fixAt(0.05, 0), declaredFrameCount: 1 });
      expect(out.json.error.code).toBe('ASSIGNMENT_NOT_ACTIVE');
    });

    it('a check-in straight from ASSIGNED walks through EN_ROUTE (both logged)', async () => {
      setNow(e2e, plus(START_X, -5));
      const res = await act(proA, 'X', 'check-in', fixAt(0.05, 0));
      expect(res.status).toBe(200);
      const rows = await e2e.db.sql<
        { from_status: string; to_status: string; actor_kind: string; reason: string }[]
      >`
        SELECT from_status, to_status, actor_kind, reason FROM booking_status_events
        WHERE booking_id = ${bookingOf('X')} AND to_status IN ('EN_ROUTE', 'CHECKED_IN') ORDER BY id`;
      expect(rows).toEqual([
        expect.objectContaining({
          from_status: 'ASSIGNED',
          to_status: 'EN_ROUTE',
          actor_kind: 'PHOTOGRAPHER',
        }),
        expect.objectContaining({
          from_status: 'EN_ROUTE',
          to_status: 'CHECKED_IN',
          actor_kind: 'PHOTOGRAPHER',
        }),
      ]);
      expect(rows[0]?.reason).toMatch(/^Auto:/);
    });

    it('waiting cannot exceed the minutes since the billing start; client absence waits 60 min', async () => {
      setNow(e2e, plus(START_X, 40));
      const tooMuch = await act(proA, 'X', 'waiting', {
        minutes: 50,
        note: 'Nobody here',
        ...fixAt(0, 0),
      });
      expect(tooMuch.status).toBe(422);
      expect(tooMuch.json.error).toMatchObject({
        code: 'WAITING_EXCEEDS_ELAPSED',
        details: { elapsedMinutes: 40 },
      });
      const early = await act(proA, 'X', 'client-absent', {
        ...fixAt(0.05, 0),
        note: 'Nobody here',
      });
      expect(early.status).toBe(409);
      expect(early.json.error.code).toBe('TOO_EARLY');
    });

    it('waiting over 60 min charges 45 (cap minus grace), flags ops, and is logged once', async () => {
      setNow(e2e, plus(START_X, 80));
      const res = await act(proA, 'X', 'waiting', {
        minutes: 75,
        note: 'Still nobody',
        ...fixAt(0, 0),
      });
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({
        minutes: 75,
        chargeableMinutes: 45,
        capped: true,
        snapshotSequence: 2,
      });
      const again = await act(proA, 'X', 'waiting', { minutes: 10, note: 'Again', ...fixAt(0, 0) });
      expect(again.json.error.code).toBe('WAITING_ALREADY_LOGGED');
      const capped = await e2e.db.sql`
        SELECT 1 FROM domain_events WHERE aggregate_id = ${bookingOf('X')}
          AND event_type = 'assignment.waiting_capped'`;
      expect(capped).toHaveLength(1);
    });

    it('client absent after 60 min: treated as completed — CHECKED_OUT, 0 frames, SLA anchored, review', async () => {
      const res = await act(proA, 'X', 'client-absent', {
        ...fixAt(0.05, 0),
        note: 'Venue locked, phone off',
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ bookingStatus: 'CHECKED_OUT', declaredFrameCount: 0 });
      const b = await bookingRow('X');
      expect(b?.status).toBe('CHECKED_OUT');
      expect(b?.sla_t0?.getTime()).toBe(b?.actual_check_out?.getTime());
      const timeline = await e2e.db.sql<{ to_status: string; actor_kind: string }[]>`
        SELECT to_status, actor_kind FROM booking_status_events
        WHERE booking_id = ${bookingOf('X')} AND to_status IN ('IN_PROGRESS', 'CHECKED_OUT') ORDER BY id`;
      expect(timeline).toEqual([
        { to_status: 'IN_PROGRESS', actor_kind: 'SYSTEM' },
        { to_status: 'CHECKED_OUT', actor_kind: 'PHOTOGRAPHER' },
      ]);
      const [review] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${bookingOf('X')}
          AND event_type = 'booking.needs_review'`;
      expect(review?.payload).toMatchObject({ reason: 'CLIENT_NON_ATTENDANCE' });
    });
  });

  describe('booking Y: the extension lifecycle', () => {
    let eventId: string;
    const request = () => act(proA, 'Y', 'extensions', { hours: 1 });

    it('one open request at a time; it expires after 10 minutes', async () => {
      setNow(e2e, plus(START_Y, -10));
      await act(proA, 'Y', 'check-in', fixAt(0.05, 0));
      await act(proA, 'Y', 'start');
      setNow(e2e, plus(START_Y, 60));
      const first = await request();
      expect(first.status).toBe(201);
      eventId = first.json.data.eventId;
      expect((await request()).json.error.code).toBe('EXTENSION_PENDING');
      setNow(e2e, plus(START_Y, 70));
      await e2e.runDueJobs();
      const late = await clientCall('Y', `extensions/${eventId}/approve`);
      expect(late.status).toBe(409);
      expect(late.json.error.code).toBe('EXTENSION_EXPIRED');
      expect(await eventKinds('Y')).toEqual(['EXTENSION_REQUESTED', 'EXTENSION_DECLINED:EXPIRED']);
    });

    it('a lapsed request whose job was lost is still expired on approval', async () => {
      eventId = (await request()).json.data.eventId;
      setNow(e2e, plus(START_Y, 81));
      const res = await clientCall('Y', `extensions/${eventId}/approve`);
      expect(res.json.error.code).toBe('EXTENSION_EXPIRED');
      expect((await eventKinds('Y')).slice(-1)).toEqual(['EXTENSION_DECLINED:EXPIRED']);
    });

    it("only the booking's owner may answer; a declined request cannot be approved", async () => {
      eventId = (await request()).json.data.eventId;
      const stranger = await clientCall('Y', `extensions/${eventId}/approve`, otherUserId);
      expect(stranger.status).toBe(404);
      expect(stranger.json.error.code).toBe('BOOKING_NOT_FOUND');
      const declined = await clientCall('Y', `extensions/${eventId}/decline`);
      expect(declined.status).toBe(200);
      expect(declined.json.data).toMatchObject({ status: 'DECLINED', snapshotSequence: null });
      expect((await clientCall('Y', `extensions/${eventId}/approve`)).json.error.code).toBe(
        'EXTENSION_NOT_OPEN',
      );
      expect((await clientCall('Y', 'extensions/999999/approve')).status).toBe(404);
    });

    it('approval that would overlap the next booking is declined: 409 EXTENSION_CONFLICT', async () => {
      const before = await bookingRow('Y');
      const [blockBefore] = await e2e.db.sql<{ blocked_until: Date }[]>`
        SELECT blocked_until FROM assignments WHERE id = ${assignmentOf('Y')}`;
      // The client said no at +81: the photographer may ask again 10 minutes later (L3).
      const tooSoon = await request();
      expect(tooSoon.json.error).toMatchObject({
        code: 'EXTENSION_COOLDOWN',
        details: { retryAt: plus(START_Y, 91).toISOString() },
      });
      setNow(e2e, plus(START_Y, 91));
      eventId = (await request()).json.data.eventId;
      const res = await clientCall('Y', `extensions/${eventId}/approve`);
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('EXTENSION_CONFLICT');
      expect((await eventKinds('Y')).slice(-1)).toEqual(['EXTENSION_DECLINED:CALENDAR_CONFLICT']);
      expect((await bookingRow('Y'))?.total_paise).toBe(before?.total_paise);
      const [blockAfter] = await e2e.db.sql<{ blocked_until: Date }[]>`
        SELECT blocked_until FROM assignments WHERE id = ${assignmentOf('Y')}`;
      expect(blockAfter?.blocked_until.getTime()).toBe(blockBefore?.blocked_until.getTime());
      const snapshots = await e2e.db
        .sql`SELECT 1 FROM booking_price_snapshots WHERE booking_id = ${bookingOf('Y')}`;
      expect(snapshots).toHaveLength(1);
    });
  });

  describe('booking W: at most four extensions', () => {
    it('approves four one-hour extensions, then refuses a fifth', async () => {
      setNow(e2e, plus(START_W, -5));
      await act(proA, 'W', 'check-in', fixAt(0.05, 0));
      await act(proA, 'W', 'start');
      const sequences: number[] = [];
      for (let i = 0; i < 4; i++) {
        const req = await act(proA, 'W', 'extensions', { hours: 1 });
        expect(req.status, JSON.stringify(req.json)).toBe(201);
        const ok = await clientCall('W', `extensions/${req.json.data.eventId}/approve`);
        expect(ok.status, JSON.stringify(ok.json)).toBe(200);
        sequences.push(ok.json.data.snapshotSequence);
      }
      expect(sequences).toEqual([2, 3, 4, 5]);
      const fifth = await act(proA, 'W', 'extensions', { hours: 1 });
      expect(fifth.status).toBe(409);
      expect(fifth.json.error.code).toBe('EXTENSION_LIMIT');
      // 2 booked + 4 extension hours from the billing start (the scheduled start).
      setNow(e2e, plus(START_W, 359));
      const early = await act(proA, 'W', 'check-out', {
        ...fixAt(0.05, 0),
        declaredFrameCount: 600,
      });
      expect(early.json.error.details.earliestCheckOutAt).toBe(plus(START_W, 360).toISOString());
    });
  });

  describe('booking V: incidents and offline time', () => {
    it('keeps a plausible offline device time as the check-in time', async () => {
      setNow(e2e, plus(START_V, -5));
      const deviceTs = plus(START_V, -12).toISOString();
      const res = await act(proA, 'V', 'check-in', { ...fixAt(0.05, 0), offline: true, deviceTs });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ checkedInAt: deviceTs, offline: true });
    });

    it('reports access denied (alerting ops); a replay of the same report is a no-op', async () => {
      const deviceTs = e2e.now().toISOString();
      const body = { note: 'Security will not let me in', ...fixAt(0.05, 0), deviceTs };
      const res = await act(proA, 'V', 'access-denied', body);
      expect(res.status).toBe(201);
      const replay = await act(proA, 'V', 'access-denied', body);
      expect(replay.json.data).toMatchObject({ eventId: res.json.data.eventId, replayed: true });
      await drainOutbox(e2e);
      const alerts = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${bookingOf('V')} AND event_type = 'ops.alert'`;
      expect(alerts.map((a) => a.payload.source_event_type)).toContain(
        'assignment.access_denied_reported',
      );
    });

    it('staff confirmation (dev stand-in) needs a matching report, then ends the booking', async () => {
      const unsafe = await e2e.call(
        'POST',
        `/dev/assignments/${assignmentOf('V')}/confirm-incident`,
        {
          body: { kind: 'UNSAFE_SITE' },
        },
      );
      expect(unsafe.status).toBe(409);
      expect(unsafe.json.error.code).toBe('NO_INCIDENT_REPORTED');
      const res = await e2e.call('POST', `/dev/assignments/${assignmentOf('V')}/confirm-incident`, {
        body: { kind: 'ACCESS_DENIED' },
      });
      expect(res.status).toBe(200);
      expect(res.json.data.bookingStatus).toBe('ACCESS_DENIED');
      const b = await bookingRow('V');
      expect(b).toMatchObject({ status: 'ACCESS_DENIED', sla_t0: null });
      const [a] = await e2e.db.sql<
        { status: string }[]
      >`SELECT status FROM assignments WHERE id = ${assignmentOf('V')}`;
      expect(a?.status).toBe('COMPLETED');
      const [review] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${bookingOf('V')} AND event_type = 'booking.needs_review'`;
      expect(review?.payload).toMatchObject({
        reason: 'ACCESS_DENIED_CHARGE_50',
        charge_bps: 5000,
      });
    });
  });

  describe('booking U: device time and waiting are bounded (security review H1/H2)', () => {
    it('a check-in device time that hid a late arrival stands, but goes to ops review', async () => {
      setNow(e2e, plus(START_U, 25));
      const deviceTs = plus(START_U, 5).toISOString();
      const res = await act(proA, 'U', 'check-in', { ...fixAt(0.05, 0), offline: true, deviceTs });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ checkedInAt: deviceTs });
      const [review] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${bookingOf('U')}
          AND event_type = 'booking.needs_review'`;
      expect(review?.payload).toMatchObject({
        reason: 'OFFLINE_CHECK_IN_TIME',
        device_check_in_at: deviceTs,
        server_received_at: plus(START_U, 25).toISOString(),
      });
    });

    it('time after the shoot started is never waiting', async () => {
      setNow(e2e, plus(START_U, 30));
      expect((await act(proA, 'U', 'start')).status).toBe(200);
      setNow(e2e, plus(START_U, 90));
      const res = await act(proA, 'U', 'waiting', { minutes: 40, note: 'Late', ...fixAt(0, 0) });
      expect(res.status).toBe(422);
      expect(res.json.error).toMatchObject({
        code: 'WAITING_EXCEEDS_ELAPSED',
        details: { elapsedMinutes: 25 },
      });
    });
  });
});
