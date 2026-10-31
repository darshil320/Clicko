import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { checkedOutBooking, fakeFile, SIGNATURES } from './modules/media/__tests__/media-fixtures';
import { uploadAll } from './test-support/delivery-fixtures';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  fixAt,
  insertClient,
  proAction,
  setNow,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, staffToken } from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START_V = new Date(NOW.getTime() + 6 * DAY);
const START_D = new Date(NOW.getTime() + 10 * DAY);
let keySeq = 0;
const idem = () => `admin-desk-${String(++keySeq).padStart(6, '0')}`;

/**
 * ADR-0025 D3/D5 end to end, on real flows: a booking walked to QA (then late, so its delivery
 * promise breaches), one still dispatching, one where access is denied on site. Each desk's happy
 * path, the role matrix (403), city scoping (another city's booking is a 404 and absent from
 * lists), READ_ONLY masking, and the audit rows each decision writes.
 */
describe.runIf(TEST_DATABASE_URL)('the staff desks', () => {
  let e2e: E2eApp;
  const staff = {} as Record<
    'admin' | 'cmSurat' | 'cmMumbai' | 'ops' | 'qm' | 'support' | 'finance' | 'readOnly',
    string
  >;
  let qBooking: string;
  let vBooking: string;
  let vAssignment: string;
  let dBooking: string;
  let proB: string;

  /** A fresh token per call: the clock jumps days, a token lives 15 minutes. */
  const as = async (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  const get = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', path, { token: await as(who) });
  const post = async (who: keyof typeof staff, path: string, body?: unknown) =>
    e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });
  const ids = (res: { json: Json }, key = 'id') =>
    (res.json.data.items as Json[]).map((i) => i[key] as string);
  const auditRows = (action: string) =>
    e2e.db.sql<{ actor_id: string; entity_id: string; before_state: Json; after_state: Json }[]>`
      SELECT actor_id, entity_id, before_state, after_state FROM audit_logs
      WHERE action = ${action} ORDER BY id`;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      staff[key] = (await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId)).id;
    };
    await make('admin', 'SUPER_ADMIN');
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT');
    await make('qm', 'QUALITY_MANAGER');
    await make('support', 'SUPPORT');
    await make('finance', 'FINANCE');
    await make('readOnly', 'READ_ONLY');

    // Q: shot, uploaded, exported — waiting in QA.
    await insertPhotographer(e2e.db.sql, {
      phone: '+919999179201',
      km: 3,
      categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
    });
    const proToken = await e2e.proLogin('+919999179201');
    const q = await checkedOutBooking(e2e, {
      clientPhone: '+919999279201',
      proToken,
      declaredFrames: 1,
    });
    qBooking = q.bookingId;
    await uploadAll(
      e2e,
      proToken,
      qBooking,
      [
        {
          clientFileId: 'raw',
          name: 'A.CR3',
          kind: 'RAW_PHOTO',
          bytes: fakeFile(64_000, 21, SIGNATURES.CR3),
        },
        {
          clientFileId: 'jpg',
          name: 'A.JPG',
          kind: 'JPEG_PHOTO',
          bytes: fakeFile(32_000, 22, SIGNATURES.JPEG),
        },
      ],
      1,
    );
    await drainOutbox(e2e);
    await e2e.scheduler.runDue(e2e.get(JobRegistry), e2e.now(), JOB.MEDIA_JPEG_EXPORT);
    await drainOutbox(e2e);

    // D: paid, still dispatching. V: accepted, shot later (access denied).
    proB = await insertPhotographer(e2e.db.sql, {
      phone: '+919999179202',
      km: 3,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    dBooking = (await bookAndPay(e2e, await insertClient(e2e, '+919999279202'), START_D)).id;
    vBooking = (await bookAndPay(e2e, await insertClient(e2e, '+919999279203'), START_V)).id;
    vAssignment = await acceptOffer(e2e, proB, vBooking);
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('cities for the pickers', () => {
    it('lists every city for an all-cities grant, only the grant cities otherwise', async () => {
      const all = await get('readOnly', '/admin/cities');
      expect(all.status).toBe(200);
      expect((all.json.data as Json[]).map((c) => c.name)).toEqual(
        expect.arrayContaining(['Mumbai', 'Surat']),
      );
      const mine = await get('cmMumbai', '/admin/cities');
      expect(mine.json.data).toEqual([
        expect.objectContaining({
          name: 'Mumbai',
          state: expect.any(String),
          status: expect.any(String),
        }),
      ]);
    });
  });

  describe('booking board (every role, city-scoped)', () => {
    it('lists bookings with filters, search and a keyset cursor', async () => {
      const all = await get('admin', '/admin/bookings');
      expect(all.status).toBe(200);
      expect(ids(all)).toEqual(expect.arrayContaining([qBooking, dBooking, vBooking]));
      const qa = await get('readOnly', '/admin/bookings?status=QA');
      expect(ids(qa)).toEqual([qBooking]);
      const two = await get('ops', '/admin/bookings?status=QA,DISPATCHING,ASSIGNED&limit=2');
      expect(ids(two)).toHaveLength(2);
      const rest = await get(
        'ops',
        `/admin/bookings?status=QA&status=DISPATCHING&status=ASSIGNED&limit=2&cursor=${two.json.data.nextCursor}`,
      );
      expect([...ids(two), ...ids(rest)].sort()).toEqual([qBooking, dBooking, vBooking].sort());
      const reference = (all.json.data.items as Json[]).find((b) => b.id === qBooking)?.reference;
      expect(ids(await get('finance', `/admin/bookings?q=${reference}`))).toEqual([qBooking]);
      const day = new Date(START_D.getTime() + 5.5 * HOUR).toISOString().slice(0, 10);
      expect(ids(await get('support', `/admin/bookings?from=${day}&to=${day}`))).toEqual([
        dBooking,
      ]);
    });

    it("a city manager sees only their city: another city's booking is absent and a 404", async () => {
      expect(ids(await get('cmMumbai', '/admin/bookings'))).toEqual([]);
      expect(ids(await get('cmSurat', '/admin/bookings'))).toContain(qBooking);
      const detail = await get('cmMumbai', `/admin/bookings/${qBooking}`);
      expect([detail.status, detail.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      expect((await get('cmMumbai', `/admin/bookings/not-a-uuid`)).status).toBe(404);
    });

    it('the booking page shows the timeline, payments and assignment; READ_ONLY sees the phone masked', async () => {
      const full = await get('ops', `/admin/bookings/${qBooking}`);
      expect(full.status).toBe(200);
      expect(full.json.data).toMatchObject({
        id: qBooking,
        status: 'QA',
        cityName: 'Surat',
        // The booker comes from test-support/booking-fixtures.ts (shared with module tests).
        client: { phone: '+919876543210' },
        assignment: { status: 'COMPLETED' },
      });
      expect(full.json.data.timeline.map((t: Json) => t.toStatus)).toContain('QA');
      expect(full.json.data.payments[0]).toMatchObject({ kind: 'ADVANCE', status: 'CAPTURED' });
      expect(full.json.data.slaClocks.length).toBeGreaterThan(0);
      const masked = await get('readOnly', `/admin/bookings/${qBooking}`);
      expect(masked.json.data.client.phone).toBe('+91******3210');
    });
  });

  describe('dispatch desk', () => {
    it('lists DISPATCHING bookings with wave, offers and deadline; FINANCE may not look', async () => {
      const res = await get('readOnly', '/admin/dispatch');
      expect(res.status).toBe(200);
      const item = (res.json.data.items as Json[]).find((i) => i.bookingId === dBooking);
      expect(item).toMatchObject({ exhausted: false, cityName: 'Surat' });
      expect(item?.wave).toBeGreaterThanOrEqual(1);
      expect(item?.pendingOffers).toBeGreaterThanOrEqual(1);
      expect(Date.parse(item?.deadlineAt)).toBeLessThan(START_D.getTime());
      const detail = await get('support', `/admin/dispatch/${dBooking}`);
      expect(detail.json.data.rounds.length).toBeGreaterThanOrEqual(1);
      expect((await get('finance', '/admin/dispatch')).status).toBe(403);
      expect((await get('cmMumbai', `/admin/dispatch/${dBooking}`)).status).toBe(404);
    });
  });

  describe('QA desk', () => {
    it('lists the queue with its counts and due time; roles outside the matrix get 403', async () => {
      const res = await get('qm', '/admin/qa');
      const [item] = res.json.data.items as Json[];
      expect(item).toMatchObject({ bookingId: qBooking, declaredFrameCount: 1, cityName: 'Surat' });
      expect(item?.counts.raw).toBe(1);
      expect(item?.dueAt).toBeTruthy();
      expect((await get('support', '/admin/qa')).status).toBe(403);
      expect((await post('finance', `/admin/qa/${qBooking}`, { result: 'PASS' })).status).toBe(403);
      expect(ids(await get('cmMumbai', '/admin/qa'), 'bookingId')).toEqual([]);
      expect((await post('cmMumbai', `/admin/qa/${qBooking}`, { result: 'PASS' })).status).toBe(
        404,
      );
    });

    it('a fail needs a note; the decision is the staff member’s and is audited', async () => {
      const bare = await post('cmSurat', `/admin/qa/${qBooking}`, { result: 'FAIL' });
      expect(bare.status).toBe(400);
      const res = await post('cmSurat', `/admin/qa/${qBooking}`, {
        result: 'FAIL',
        note: 'Frame 12 corrupt — please re-send',
      });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ qaStatus: 'FAILED', bookingStatus: 'QA' });
      const [row] = await auditRows('qa.decide');
      expect(row).toMatchObject({
        actor_id: staff.cmSurat,
        entity_id: qBooking,
        before_state: { status: 'QA', qa_status: null },
        after_state: { status: 'QA', qa_status: 'FAILED' },
      });
    });

    it('a late pass moves to BALANCE_PENDING as STAFF and records the breach', async () => {
      setNow(e2e, new Date(NOW.getTime() + 49 * HOUR));
      await e2e.runDueJobs();
      await drainOutbox(e2e);
      const res = await post('qm', `/admin/qa/${qBooking}`, { result: 'PASS' });
      expect(res.json.data).toMatchObject({ qaStatus: 'PASSED', bookingStatus: 'BALANCE_PENDING' });
      const [delivery] = await e2e.db.sql<{ qa_by: string }[]>`
        SELECT qa_by FROM deliveries WHERE booking_id = ${qBooking}`;
      expect(delivery?.qa_by).toBe(staff.qm);
      const [event] = await e2e.db.sql<{ actor_kind: string; actor_id: string }[]>`
        SELECT actor_kind, actor_id FROM booking_status_events
        WHERE booking_id = ${qBooking} AND to_status = 'BALANCE_PENDING'`;
      expect(event).toEqual({ actor_kind: 'STAFF', actor_id: staff.qm });
      await drainOutbox(e2e);
    });
  });

  describe('SLA breach board', () => {
    let breachId: string;

    it('lists the open breach for the roles allowed', async () => {
      const res = await get('qm', '/admin/breaches');
      const [item] = res.json.data.items as Json[];
      expect(item).toMatchObject({ bookingId: qBooking, attributedTo: 'CLICKCO', waived: false });
      breachId = item?.id;
      const board = await get('ops', '/admin/bookings?status=BALANCE_PENDING');
      expect((board.json.data.items as Json[])[0]?.flags).toContain('SLA_BREACHED');
      expect((await get('ops', '/admin/breaches')).status).toBe(403);
      expect(ids(await get('cmMumbai', '/admin/breaches'))).toEqual([]);
    });

    it('re-attributes and waives without moving money; a waived breach is closed', async () => {
      expect(
        (
          await post('cmMumbai', `/admin/breaches/${breachId}/attribute`, {
            attributedTo: 'CLIENT',
            note: 'Venue changed the brief',
          })
        ).status,
      ).toBe(404);
      // ADR-0016 D9: staff may only move a breach off Clickco and the photographer, never onto them.
      const ontoPhotographer = await post('cmSurat', `/admin/breaches/${breachId}/attribute`, {
        attributedTo: 'PHOTOGRAPHER',
        note: 'Trying to move it onto the payout',
      });
      expect(ontoPhotographer.status).toBe(400);
      const attributed = await post('cmSurat', `/admin/breaches/${breachId}/attribute`, {
        attributedTo: 'CLIENT',
        note: 'Client asked to hold the delivery',
      });
      expect(attributed.json.data).toMatchObject({ attributedTo: 'CLIENT', applied: false });
      // Put down to the client, nothing is owed: it leaves the open queue the S10 remedy desk
      // works from, and no money row appears.
      expect(ids(await get('qm', '/admin/breaches'))).toEqual([]);
      expect(ids(await get('qm', '/admin/breaches?status=ALL'))).toEqual([breachId]);
      const [money] = await e2e.db.sql<{ n: number }[]>`
        SELECT (SELECT count(*) FROM client_credits WHERE source_booking_id = ${qBooking})::int
             + (SELECT count(*) FROM refunds WHERE booking_id = ${qBooking})::int AS n`;
      expect(money?.n).toBe(0);
      const [event] = await e2e.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM domain_events
        WHERE event_type = 'sla.breach_attributed' AND aggregate_id = ${qBooking}`;
      expect(event?.n).toBe(1);
      const waived = await post('qm', `/admin/breaches/${breachId}/waive`, {
        reason: 'Client-caused delay',
      });
      expect(waived.json.data).toMatchObject({ waived: true, waiveReason: 'Client-caused delay' });
      const again = await post('qm', `/admin/breaches/${breachId}/waive`, { reason: 'Twice' });
      expect(again.json.error.code).toBe('BREACH_WAIVED');
      expect(ids(await get('qm', '/admin/breaches'))).toEqual([]);
      expect(ids(await get('qm', '/admin/breaches?status=WAIVED'))).toEqual([breachId]);
      const [row] = await e2e.db.sql<{ applied_at: Date | null; waived_by: string }[]>`
        SELECT applied_at, waived_by FROM sla_breaches WHERE id = ${breachId}`;
      expect(row).toEqual({ applied_at: null, waived_by: staff.qm });
      expect((await auditRows('breach.attribute'))[0]).toMatchObject({
        actor_id: staff.cmSurat,
        entity_id: breachId,
        after_state: { attributed_to: 'CLIENT' },
      });
      expect((await auditRows('breach.waive'))[0]?.actor_id).toBe(staff.qm);
    });
  });

  describe('alert feed', () => {
    it('shows alerts and reviews newest first, paginated, city-filtered', async () => {
      const first = await get('finance', '/admin/alerts?limit=3');
      expect(first.status).toBe(200);
      const items = first.json.data.items as Json[];
      expect(items).toHaveLength(3);
      const times = items.map((a) => Date.parse(a.occurredAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      const next = await get(
        'finance',
        `/admin/alerts?limit=3&cursor=${first.json.data.nextCursor}`,
      );
      const seen = [...items, ...(next.json.data.items as Json[])].map((a) => a.eventId);
      expect(new Set(seen).size).toBe(seen.length);
      const all = await get('admin', '/admin/alerts?limit=100');
      const forQ = (all.json.data.items as Json[]).filter((a) => a.bookingId === qBooking);
      expect(forQ.map((a) => a.reason)).toEqual(
        expect.arrayContaining(['SLA_BREACH_REMEDY', 'sla.breached']),
      );
      expect(forQ.every((a) => a.bookingReference)).toBe(true);
      expect(ids(await get('cmMumbai', '/admin/alerts'), 'eventId')).toEqual([]);
    });

    it('flags the booking on the board and powers needs-attention', async () => {
      const res = await get('ops', '/admin/bookings?needsAttention=true');
      const q = (res.json.data.items as Json[]).find((b) => b.id === qBooking);
      expect(q?.flags).toEqual(expect.arrayContaining(['NEEDS_REVIEW', 'OPS_ALERT']));
      expect(q?.flags).not.toContain('SLA_BREACHED'); // its only breach was waived
    });
  });

  describe('incident desk', () => {
    it('lists an unconfirmed access-denied report; QM may not confirm', async () => {
      setNow(e2e, new Date(START_V.getTime() - 5 * 60_000));
      expect((await proAction(e2e, proB, vAssignment, 'check-in', fixAt(0.05, 0))).status).toBe(
        200,
      );
      const report = await proAction(e2e, proB, vAssignment, 'access-denied', {
        note: 'Society guard refused entry',
        ...fixAt(0.05, 0),
      });
      expect(report.status).toBe(201);
      await drainOutbox(e2e);
      const res = await get('ops', '/admin/incidents');
      expect(res.json.data.items).toEqual([
        expect.objectContaining({
          kind: 'ACCESS_DENIED',
          assignmentId: vAssignment,
          bookingId: vBooking,
          bookingStatus: 'CHECKED_IN',
          note: 'Society guard refused entry',
        }),
      ]);
      expect((await get('qm', '/admin/incidents')).status).toBe(403);
      const flagged = await get('ops', `/admin/bookings?status=CHECKED_IN`);
      expect((flagged.json.data.items as Json[])[0]?.flags).toContain('INCIDENT_REPORTED');
    });

    it('a staff confirmation ends the booking as that staff member, audited on the assignment', async () => {
      const body = { kind: 'ACCESS_DENIED', note: 'Called the client: entry refused' };
      expect(
        (await post('cmMumbai', `/admin/assignments/${vAssignment}/confirm-incident`, body)).status,
      ).toBe(404);
      const unsafe = await post('ops', `/admin/assignments/${vAssignment}/confirm-incident`, {
        kind: 'UNSAFE_SITE',
        note: 'Wrong kind',
      });
      expect(unsafe.json.error.code).toBe('NO_INCIDENT_REPORTED');
      const res = await post('ops', `/admin/assignments/${vAssignment}/confirm-incident`, body);
      expect(res.json.data).toEqual({
        assignmentId: vAssignment,
        bookingId: vBooking,
        bookingStatus: 'ACCESS_DENIED',
      });
      const [event] = await e2e.db.sql<{ actor_kind: string; actor_id: string; metadata: Json }[]>`
        SELECT actor_kind, actor_id, metadata FROM booking_status_events
        WHERE booking_id = ${vBooking} AND to_status = 'ACCESS_DENIED'`;
      expect(event).toMatchObject({
        actor_kind: 'STAFF',
        actor_id: staff.ops,
        metadata: { staff_note: body.note },
      });
      expect(ids(await get('ops', '/admin/incidents'), 'eventId')).toEqual([]);
      const detail = await get('admin', `/admin/bookings/${vBooking}`);
      expect(detail.json.data.audit.map((a: Json) => a.action)).toContain('incident.confirm');
    });
  });

  describe('audit view', () => {
    it("the booking page shows the booking's audit trail, newest first", async () => {
      const res = await get('readOnly', `/admin/bookings/${qBooking}`);
      const actions = (res.json.data.audit as Json[]).map((a) => a.action);
      expect(actions).toEqual(['breach.waive', 'breach.attribute', 'qa.decide', 'qa.decide']);
    });
  });
});
