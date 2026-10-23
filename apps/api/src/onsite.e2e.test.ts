import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pointAt } from './infra/db/seeds/geo-offset';
import { JOB } from './infra/queues/queue-names';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  fixAt,
  idemKey,
  insertClient,
  SURAT_CENTRE,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const START = new Date(NOW.getTime() + 5 * DAY); // Sunday 15 Nov, 12:00 IST

describe.runIf(TEST_DATABASE_URL)(
  'on-site end to end: en-route → check-in → extension → waiting → check-out',
  () => {
    let e2e: E2eApp;
    let userId: string;
    let proId: string;
    let booking: Json;
    let assignmentId: string;
    let totalBefore: number;
    let advanceBefore: number;
    let blockedUntilBefore: Date;
    const client = () => tokenFor(e2e, 'USER', userId);
    const pro = () => tokenFor(e2e, 'PHOTOGRAPHER', proId);
    const proCall = async (
      path: string,
      body?: unknown,
      idem = idemKey(path.split('/').pop() ?? 'x'),
    ) =>
      e2e.call('POST', `/pro/assignments/${assignmentId}/${path}`, {
        token: await pro(),
        idempotencyKey: idem,
        ...(body === undefined ? {} : { body }),
      });

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
      proId = await insertPhotographer(e2e.db.sql, {
        phone: '+919825099101',
        name: 'Meera Joshi',
        km: 3,
        categories: [{ code: 'FOOD', tier: 'EXPERT' }],
      });
      userId = await insertClient(e2e, '+919700000801');
      booking = await bookAndPay(e2e, userId, START);
      assignmentId = await acceptOffer(e2e, proId, booking.id);
      const [b] = await e2e.db.sql<{ total_paise: string; advance_paise: string }[]>`
        SELECT total_paise, advance_paise FROM bookings WHERE id = ${booking.id}`;
      totalBefore = Number(b?.total_paise);
      advanceBefore = Number(b?.advance_paise);
      const [a] = await e2e.db.sql<{ blocked_until: Date }[]>`
        SELECT blocked_until FROM assignments WHERE id = ${assignmentId}`;
      blockedUntilBefore = a?.blocked_until ?? new Date(0);
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('accepting arms the no-show check at start + 15 min', () => {
      const jobs = e2e.scheduler.pending(JOB.ONSITE_NO_SHOW_CHECK);
      expect(jobs).toEqual([
        expect.objectContaining({
          data: { assignmentId },
          at: new Date(START.getTime() + 15 * MIN),
        }),
      ]);
    });

    it('en-route opens 3 h before the start', async () => {
      setNow(e2e, new Date(START.getTime() - 4 * HOUR));
      const early = await proCall('en-route');
      expect(early.status).toBe(409);
      expect(early.json.error.code).toBe('TOO_EARLY');
      setNow(e2e, new Date(START.getTime() - 40 * MIN));
      const ok = await proCall('en-route');
      expect(ok.status).toBe(200);
      expect(ok.json.data).toEqual({
        assignmentId,
        bookingId: booking.id,
        bookingStatus: 'EN_ROUTE',
      });
    });

    it('refuses a rough fix and a fix far from the venue point', async () => {
      setNow(e2e, new Date(START.getTime() - 10 * MIN));
      const rough = await proCall('check-in', { ...fixAt(0.05, 0), accuracyM: 150 });
      expect(rough.status).toBe(422);
      expect(rough.json.error.code).toBe('LOCATION_TOO_INACCURATE');
      const far = await proCall('check-in', fixAt(40, 0));
      expect(far.status).toBe(422);
      expect(far.json.error.code).toBe('OUTSIDE_GEOFENCE');
    });

    it('checks in within 150 m of the fallback venue point; billing starts at the scheduled start', async () => {
      const deviceTs = e2e.now().toISOString();
      const res = await proCall('check-in', fixAt(0.05, 0, SURAT_CENTRE, { deviceTs }));
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        assignmentId,
        bookingStatus: 'CHECKED_IN',
        geofenceBasis: 'CITY_CENTRE',
        geofenceVerified: true,
        offline: false,
        billingStartsAt: START.toISOString(),
        replayed: false,
      });
      expect(res.json.data.distanceM).toBeLessThan(60);

      // The same event replayed later by the offline queue (a new idempotency key): no write.
      const replay = await proCall('check-in', fixAt(0.05, 0, SURAT_CENTRE, { deviceTs }));
      expect(replay.status).toBe(200);
      expect(replay.json.data.replayed).toBe(true);
      expect(replay.json.data.checkedInAt).toBe(res.json.data.checkedInAt);
      // A different second check-in is refused: the check-in is immutable.
      const again = await proCall(
        'check-in',
        fixAt(0.05, 0, SURAT_CENTRE, { deviceTs: new Date().toISOString() }),
      );
      expect(again.status).toBe(409);
      expect(again.json.error.code).toBe('CHECK_IN_ALREADY_RECORDED');

      const [b] = await e2e.db.sql<{ status: string; actual_check_in: Date }[]>`
        SELECT status, actual_check_in FROM bookings WHERE id = ${booking.id}`;
      expect(b?.status).toBe('CHECKED_IN');
      expect(b?.actual_check_in.toISOString()).toBe(res.json.data.checkedInAt);
    });

    it('the no-show check at start + 15 min does nothing once checked in', async () => {
      setNow(e2e, new Date(START.getTime() + 15 * MIN));
      await e2e.runDueJobs();
      const [b] = await e2e.db.sql<
        { status: string }[]
      >`SELECT status FROM bookings WHERE id = ${booking.id}`;
      expect(b?.status).toBe('CHECKED_IN');
      expect(e2e.scheduler.pending(JOB.ONSITE_NO_SHOW_CHECK)).toEqual([]);
    });

    it('starts the shoot, requests an extension and shows it to the client', async () => {
      const started = await proCall('start');
      expect(started.json.data.bookingStatus).toBe('IN_PROGRESS');
      setNow(e2e, new Date(START.getTime() + 90 * MIN));
      const req = await proCall('extensions', { hours: 1 });
      expect(req.status).toBe(201);
      expect(req.json.data).toMatchObject({
        status: 'PENDING',
        hours: 1,
        hourlyRatePaise: 488_750, // ₹4,250 × 1.15 — never surge or weekend
        charge: { taxablePaise: 488_750, gstPaise: 87_975, totalPaise: 576_725 },
      });
      expect(e2e.scheduler.pending(JOB.ONSITE_EXTENSION_EXPIRY)).toHaveLength(1);
      const detail = await e2e.call('GET', `/bookings/${booking.id}`, { token: await client() });
      expect(detail.json.data.pendingExtensions).toEqual([
        expect.objectContaining({ eventId: req.json.data.eventId, charge: req.json.data.charge }),
      ]);
      booking = { ...booking, extensionEventId: req.json.data.eventId };
    });

    it('the client approves: snapshot 2, total and balance up, the block one hour longer', async () => {
      const res = await e2e.call(
        'POST',
        `/bookings/${booking.id}/extensions/${booking.extensionEventId}/approve`,
        { token: await client(), idempotencyKey: idemKey('approve') },
      );
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'APPROVED',
        snapshotSequence: 2,
        totalPaise: totalBefore + 576_725,
      });
      const [b] = await e2e.db.sql<
        { total_paise: string; advance_paise: string; balance_paise: string }[]
      >`
        SELECT total_paise, advance_paise, balance_paise FROM bookings WHERE id = ${booking.id}`;
      expect(Number(b?.advance_paise)).toBe(advanceBefore);
      expect(Number(b?.balance_paise)).toBe(totalBefore + 576_725 - advanceBefore);
      const [snap] = await e2e.db.sql<
        {
          hours: string;
          total_amount_paise: string;
          surge: number;
          weekend: number;
          kind: string;
        }[]
      >`
        SELECT hours, total_amount_paise, surge_multiplier_bps AS surge, weekend_multiplier_bps AS weekend,
               breakdown->>'kind' AS kind
        FROM booking_price_snapshots WHERE booking_id = ${booking.id} AND sequence = 2`;
      expect(snap).toEqual({
        hours: '1.0',
        total_amount_paise: '576725',
        surge: 10_000,
        weekend: 10_000,
        kind: 'EXTENSION',
      });
      const [a] = await e2e.db.sql<{ blocked_until: Date }[]>`
        SELECT blocked_until FROM assignments WHERE id = ${assignmentId}`;
      expect(a?.blocked_until.getTime()).toBe(blockedUntilBefore.getTime() + HOUR);
      const events = await e2e.db.sql<{ event_type: string; payload: Json }[]>`
        SELECT event_type, payload FROM domain_events
        WHERE aggregate_id = ${booking.id} AND event_type = 'assignment.extension_approved'`;
      expect(events[0]?.payload).toMatchObject({
        minutes: 60,
        amount_paise: 576_725,
        new_snapshot_sequence: 2,
      });
    });

    it('logs waiting time: 40 min → 25 chargeable at the waiting rate, snapshot 3', async () => {
      const res = await proCall('waiting', {
        minutes: 40,
        note: 'Kitchen not ready until 12:40',
        ...fixAt(0.05, 0),
      });
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({
        minutes: 40,
        chargeableMinutes: 25,
        snapshotSequence: 3,
        capped: false,
        charge: { taxablePaise: 122_188, totalPaise: 144_182 },
      });
      const detail = await e2e.call('GET', `/bookings/${booking.id}`, { token: await client() });
      expect(
        detail.json.data.charges.map((c: Json) => [
          c.kind,
          c.snapshotSequence,
          c.charge.totalPaise,
        ]),
      ).toEqual([
        ['EXTENSION', 2, 576_725],
        ['WAITING', 3, 144_182],
      ]);
      expect(detail.json.data.pendingExtensions).toEqual([]);
      expect(JSON.stringify(detail.json)).not.toContain('Kitchen not ready');
    });

    it('refuses a check-out before the booked hours plus the extension', async () => {
      setNow(e2e, new Date(START.getTime() + 150 * MIN));
      const res = await proCall('check-out', { ...fixAt(0.05, 0), declaredFrameCount: 240 });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('MINIMUM_DURATION_NOT_MET');
      expect(res.json.error.details.earliestCheckOutAt).toBe(
        new Date(START.getTime() + 180 * MIN).toISOString(),
      );
    });

    it('checks out: CHECKED_OUT with sla_t0 = check-out and delivery due 48 h later', async () => {
      setNow(e2e, new Date(START.getTime() + 181 * MIN));
      const deviceTs = e2e.now().toISOString();
      const res = await proCall('check-out', {
        ...fixAt(0.04, 90, SURAT_CENTRE, { deviceTs }),
        declaredFrameCount: 240,
      });
      expect(res.status).toBe(200);
      const out = res.json.data;
      expect(out).toMatchObject({
        bookingStatus: 'CHECKED_OUT',
        declaredFrameCount: 240,
        replayed: false,
      });
      expect(out.slaT0).toBe(out.checkedOutAt);
      expect(new Date(out.deliveryDueAt).getTime()).toBe(
        new Date(out.checkedOutAt).getTime() + 48 * HOUR,
      );

      const [b] = await e2e.db.sql<
        { status: string; actual_check_out: Date; sla_t0: Date; delivery_due_at: Date }[]
      >`
        SELECT status, actual_check_out, sla_t0, delivery_due_at FROM bookings WHERE id = ${booking.id}`;
      expect(b?.status).toBe('CHECKED_OUT');
      expect(b?.sla_t0.getTime()).toBe(b?.actual_check_out.getTime());
      const [ev] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${booking.id} AND event_type = 'booking.checked_out'`;
      expect(ev?.payload).toMatchObject({
        assignment_id: assignmentId,
        sla_t0: out.slaT0,
        declared_frame_count: 240,
        check_out_location: { lat: expect.any(Number), lng: expect.any(Number) },
      });

      const replay = await proCall('check-out', {
        ...fixAt(0.04, 90, SURAT_CENTRE, { deviceTs }),
        declaredFrameCount: 240,
      });
      expect(replay.status).toBe(200);
      expect(replay.json.data).toMatchObject({ replayed: true, checkedOutAt: out.checkedOutAt });
    });

    it('the Pro app shows the timeline, hides the address after the job, and counts earnings', async () => {
      const detail = await e2e.call('GET', `/pro/assignments/${assignmentId}`, {
        token: await pro(),
      });
      expect(detail.status).toBe(200);
      expect(detail.json.data).toMatchObject({
        status: 'COMPLETED',
        bookingStatus: 'CHECKED_OUT',
        approvedExtensionHours: 1,
        venue: { address: null, pincode: '395007' },
        checkOut: { declaredFrameCount: 240 },
      });
      expect(detail.json.data.events.map((e: Json) => e.kind)).toEqual([
        'EXTENSION_REQUESTED',
        'EXTENSION_APPROVED',
        'WAITING_LOGGED',
      ]);
      const earnings = await e2e.call('GET', '/pro/earnings', { token: await pro() });
      expect(earnings.status).toBe(200);
      const job = earnings.json.data.jobs[0];
      expect(job).toMatchObject({ assignmentId, extrasPayoutPaise: 293_250 + 73_313 });
      expect(job.totalPayoutPaise).toBe(job.basePayoutPaise + job.extrasPayoutPaise);
      expect(earnings.json.data).toMatchObject({
        basis: 'EXPECTED',
        todayPaise: job.totalPayoutPaise,
        pendingPayoutPaise: job.totalPayoutPaise,
      });
    });

    it('the dev console shows the assignment with its events (development only)', async () => {
      const view = await e2e.call('GET', `/dev/assignments/${assignmentId}`);
      expect(view.status).toBe(200);
      expect(view.json.data).toMatchObject({
        assignmentId,
        status: 'COMPLETED',
        bookingStatus: 'CHECKED_OUT',
      });
    });
  },
);

describe.runIf(TEST_DATABASE_URL)(
  'no-show: a geocoded venue fence, start + 15 alert, start + 20 re-broadcast, late replacement',
  () => {
    let e2e: E2eApp;
    let userId: string;
    let lateId: string;
    let backupId: string;
    let booking: Json;
    let assignmentId: string;
    const venue = pointAt(SURAT_CENTRE, 1, 0);
    const pro = (id: string) => tokenFor(e2e, 'PHOTOGRAPHER', id);

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
      lateId = await insertPhotographer(e2e.db.sql, {
        phone: '+919825099201',
        name: 'Late Photographer',
        km: 2,
        categories: [{ code: 'FOOD', tier: 'EXPERT' }],
      });
      userId = await insertClient(e2e, '+919700000802');
      booking = await bookAndPay(e2e, userId, START);
      assignmentId = await acceptOffer(e2e, lateId, booking.id);
      // The backup joins after the first search (so the re-broadcast is the first offer they see).
      backupId = await insertPhotographer(e2e.db.sql, {
        phone: '+919825099202',
        name: 'Backup Photographer',
        km: 4,
        bearing: 180,
        acceptsEmergency: true,
        categories: [{ code: 'FOOD', tier: 'EXPERT' }],
      });
      // S11 geocodes venues; here the booking is given its point directly.
      await e2e.db.sql`
        UPDATE bookings SET venue_location = ST_SetSRID(ST_MakePoint(${venue.lng}, ${venue.lat}), 4326)::geography
        WHERE id = ${booking.id}`;
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('a fix 200 m from a geocoded venue is outside the 150 m fence', async () => {
      setNow(e2e, new Date(START.getTime() - 20 * MIN));
      const res = await e2e.call('POST', `/pro/assignments/${assignmentId}/check-in`, {
        token: await pro(lateId),
        idempotencyKey: idemKey('fence'),
        body: fixAt(0.2, 90, venue),
      });
      expect(res.status).toBe(422);
      expect(res.json.error).toMatchObject({ code: 'OUTSIDE_GEOFENCE', details: { limitM: 150 } });
    });

    it('start + 15 min without a check-in: NO_SHOW_SUSPECTED and an ops alert', async () => {
      setNow(e2e, new Date(START.getTime() + 15 * MIN));
      await e2e.runDueJobs();
      await drainOutbox(e2e);
      const events = await e2e.db.sql<{ kind: string }[]>`
        SELECT kind FROM assignment_events WHERE assignment_id = ${assignmentId}`;
      expect(events.map((e) => e.kind)).toEqual(['NO_SHOW_SUSPECTED']);
      const types = await e2e.db.sql<{ event_type: string; payload: Json }[]>`
        SELECT event_type, payload FROM domain_events
        WHERE aggregate_id = ${booking.id} AND event_type IN ('booking.no_show_suspected', 'ops.alert')`;
      expect(types.map((t) => t.event_type)).toEqual(['booking.no_show_suspected', 'ops.alert']);
      expect(types[1]?.payload).toMatchObject({ severity: 'CRITICAL' });
    });

    it('start + 20 min: abandoned, penalised, re-broadcast at the incentive', async () => {
      setNow(e2e, new Date(START.getTime() + 20 * MIN));
      await e2e.runDueJobs();
      const [a] = await e2e.db.sql<
        { status: string }[]
      >`SELECT status FROM assignments WHERE id = ${assignmentId}`;
      expect(a?.status).toBe('ABANDONED');
      const [b] = await e2e.db.sql<
        { status: string }[]
      >`SELECT status FROM bookings WHERE id = ${booking.id}`;
      expect(b?.status).toBe('DISPATCHING');
      const [penalty] = await e2e.db.sql<{ kind: string; severity: number }[]>`
        SELECT kind, severity FROM photographer_penalties WHERE photographer_id = ${lateId}`;
      expect(penalty).toEqual({ kind: 'NO_SHOW', severity: 1 });
      const rounds = await e2e.db.sql<{ is_broadcast: boolean; outcome: string | null }[]>`
        SELECT is_broadcast, outcome FROM dispatch_rounds WHERE booking_id = ${booking.id} ORDER BY wave DESC LIMIT 1`;
      expect(rounds[0]).toEqual({ is_broadcast: true, outcome: null });
      const [redispatched] = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE aggregate_id = ${booking.id} AND event_type = 'booking.redispatching'`;
      expect(redispatched?.payload).toMatchObject({
        redispatch_kind: 'NO_SHOW',
        assignment_id: assignmentId,
      });
    });

    it('the late photographer’s offline check-in is refused and ops is told', async () => {
      const res = await e2e.call('POST', `/pro/assignments/${assignmentId}/check-in`, {
        token: await pro(lateId),
        idempotencyKey: idemKey('late-offline'),
        body: {
          ...fixAt(0.02, 0, venue),
          offline: true,
          deviceTs: new Date(START.getTime() + 5 * MIN).toISOString(),
        },
      });
      expect(res.status).toBe(409);
      expect(res.json.error.code).toBe('ASSIGNMENT_NOT_ACTIVE');
      const rows = await e2e.db.sql`
        SELECT 1 FROM domain_events WHERE aggregate_id = ${booking.id}
          AND event_type = 'assignment.offline_check_in_after_no_show'`;
      expect(rows).toHaveLength(1);
    });

    it('a replacement who checks in late flags the 25% credit for S8', async () => {
      const replacementId = await acceptOffer(e2e, backupId, booking.id);
      setNow(e2e, new Date(START.getTime() + 70 * MIN));
      const res = await e2e.call('POST', `/pro/assignments/${replacementId}/check-in`, {
        token: await pro(backupId),
        idempotencyKey: idemKey('replacement'),
        body: fixAt(0.03, 0, venue),
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        geofenceBasis: 'VENUE',
        geofenceVerified: true,
        billingStartsAt: res.json.data.checkedInAt,
      });
      const reviews = await e2e.db.sql<{ event_type: string; payload: Json }[]>`
        SELECT event_type, payload FROM domain_events WHERE aggregate_id = ${booking.id}
          AND event_type IN ('booking.late_replacement', 'booking.needs_review') ORDER BY id`;
      expect(reviews.map((r) => r.event_type)).toEqual([
        'booking.late_replacement',
        'booking.needs_review',
      ]);
      expect(reviews[1]?.payload).toMatchObject({
        reason: 'LATE_REPLACEMENT_CREDIT_25',
        minutes_late: 70,
      });
    });
  },
);
