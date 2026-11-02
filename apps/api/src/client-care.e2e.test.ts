import type { BookingStatus } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BookingsService } from './modules/bookings/bookings.service';
import { walkTo } from './modules/media/__tests__/media-fixtures';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  insertClient,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, staffToken } from './test-support/staff-fixtures';

/** Monday 7 Dec 2026, 10:00 IST. */
const NOW = new Date('2026-12-07T04:30:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const STAFF_NOTE = 'Refund agreed with the client on the phone';
const TO_DELIVERED: readonly BookingStatus[] = [
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
];
let keySeq = 0;
const idem = () => `client-care-${String(++keySeq).padStart(6, '0')}`;

/**
 * ADR-0027 D5 client entry points, end to end: a client sees the approved refunds and the credits
 * on their own booking (never someone else's, never a request still waiting for approval, never a
 * staff note); raises support tickets with the 48 h / 30 d clocks, capped per day and idempotent;
 * and reports a quality issue on their own delivered booking within 30 days, once.
 */
describe.runIf(TEST_DATABASE_URL)('client care and money entry points (ADR-0027 D5)', () => {
  let e2e: E2eApp;
  let owner: string;
  let other: string;
  let ops: string;
  let finance: string;
  let qm: string;
  let paid: Json;
  let delivered: string;
  let lateDelivered: string;
  let raced: string;
  let racer: string;

  /** Each caller gets their own forwarded IP, so the per-IP limit never mixes the scenarios. */
  const ipOf = (userId: string) =>
    `10.9.${userId === owner ? 1 : userId === other ? 2 : 3}.${(keySeq % 200) + 1}`;
  const asClient = async (
    userId: string,
    method: string,
    path: string,
    o: { body?: unknown; key?: string | null } = {},
  ) =>
    e2e.call(method, path, {
      token: await tokenFor(e2e, 'USER', userId),
      headers: { 'x-forwarded-for': ipOf(userId) },
      ...(o.body === undefined ? {} : { body: o.body }),
      ...(method === 'POST' && o.key !== null ? { idempotencyKey: o.key ?? idem() } : {}),
    });
  const asStaff = async (staffId: string, path: string, body: unknown) =>
    e2e.call('POST', path, {
      token: await staffToken(e2e, staffId),
      idempotencyKey: idem(),
      body,
    });

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development', env: { TRUST_PROXY_HOPS: '1' } });
    ops = (await bootstrapStaff(e2e, 'ops@clickco.test', 'OPS_AGENT')).id;
    finance = (await bootstrapStaff(e2e, 'finance@clickco.test', 'FINANCE')).id;
    qm = (await bootstrapStaff(e2e, 'qm@clickco.test', 'QUALITY_MANAGER')).id;
    const pro = await insertPhotographer(e2e.db.sql, {
      phone: '+919999177101',
      name: 'Asha Patel',
      km: 3,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    owner = await insertClient(e2e, '+919999277101');
    other = await insertClient(e2e, '+919999277102');
    racer = await insertClient(e2e, '+919999277103');
    paid = await bookAndPay(e2e, owner, new Date(NOW.getTime() + 10 * DAY));

    const bookings = e2e.get(BookingsService);
    const deliver = async (startInDays: number) => {
      const booking = await bookAndPay(
        e2e,
        owner,
        new Date(e2e.now().getTime() + startInDays * DAY),
      );
      const id = booking.id as string;
      await walkTo(e2e, id, await acceptOffer(e2e, pro, id), 'CHECKED_OUT', 1);
      for (const to of TO_DELIVERED) {
        const at = e2e.now();
        await e2e.db.sql.begin(async (tx) => {
          await bookings.transition(tx, {
            bookingId: id,
            to,
            actor: { kind: 'SYSTEM', id: null },
            occurredAt: at,
            reason: 'client care test fixture',
          });
          if (to === 'DELIVERED') await bookings.recordDelivered(tx, id, at);
        });
      }
      return id;
    };
    lateDelivered = await deliver(3);
    e2e.advance(20 * DAY);
    delivered = await deliver(4);
    raced = await deliver(5);
    await drainOutbox(e2e);
  }, 240_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('GET /bookings/:id/money — refunds and credits on my booking', () => {
    it('shows approved refunds (processing or refunded) and credits; hides open requests and notes', async () => {
      const ask = async (amountPaise: number) => {
        e2e.advance(1_000);
        const res = await asStaff(ops, `/admin/bookings/${paid.id}/refunds`, {
          amountPaise,
          reason: 'GOODWILL',
          note: STAFF_NOTE,
        });
        expect(res.status).toBe(201);
        return res.json.data.refunds[0].id as string;
      };
      const done = await ask(100_000);
      expect((await asStaff(finance, `/admin/refunds/${done}/approve`, {})).json.data.status).toBe(
        'COMPLETED',
      );
      // Paise ending in 14: the sandbox gateway leaves it pending.
      const pending = await ask(10_014);
      expect(
        (await asStaff(finance, `/admin/refunds/${pending}/approve`, {})).json.data.status,
      ).toBe('PROCESSING');
      const waiting = await ask(20_000);
      const credit = await asStaff(qm, `/admin/bookings/${paid.id}/credits`, {
        amountPaise: 50_000,
        reason: 'GOODWILL',
        note: STAFF_NOTE,
      });
      expect(credit.status).toBe(201);

      const res = await asClient(owner, 'GET', `/bookings/${paid.id}/money`);
      expect(res.status).toBe(200);
      const data = res.json.data;
      expect(data.bookingId).toBe(paid.id);
      expect(data.refunds).toEqual([
        {
          id: done,
          amountPaise: 100_000,
          status: 'REFUNDED',
          initiatedAt: expect.any(String),
          completedAt: expect.any(String),
        },
        {
          id: pending,
          amountPaise: 10_014,
          status: 'PROCESSING',
          initiatedAt: expect.any(String),
          completedAt: null,
        },
      ]);
      expect(data.refunds.map((r: Json) => r.id)).not.toContain(waiting);
      expect(data.credits).toEqual([
        {
          id: credit.json.data.id,
          amountPaise: 50_000,
          remainingPaise: 50_000,
          reason: 'GOODWILL',
          issuedAt: e2e.now().toISOString(),
          expiresAt: credit.json.data.expiresAt,
          expired: false,
        },
      ]);
      const text = JSON.stringify(res.json);
      expect(text).not.toContain(STAFF_NOTE);
      expect(text).not.toContain('Test FINANCE');
    });

    it("someone else's booking is 404 like a missing one; staff and Pro tokens are refused", async () => {
      const theirs = await asClient(other, 'GET', `/bookings/${paid.id}/money`);
      expect([theirs.status, theirs.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      const missing = await asClient(
        owner,
        'GET',
        '/bookings/6f1c1e0a-2a4b-4c55-9a77-0d6c0f2b9e10/money',
      );
      expect([missing.status, missing.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      expect((await asClient(owner, 'GET', '/bookings/not-a-uuid/money')).status).toBe(400);
      const staffSession = await e2e.call('GET', `/bookings/${paid.id}/money`, {
        token: await staffToken(e2e, ops),
      });
      expect(staffSession.status).toBe(403);
    });
  });

  describe('support tickets: POST and GET /me/tickets', () => {
    let first: Json;

    it('raises a ticket with or without a booking, both statutory clocks set from receipt', async () => {
      const res = await asClient(owner, 'POST', '/me/tickets', {
        body: { category: 'APP_ISSUE', message: '  The app crashes when I open my photos.  ' },
      });
      expect(res.status).toBe(201);
      first = res.json.data;
      const now = e2e.now().getTime();
      expect(first).toMatchObject({
        reference: expect.stringMatching(/^TKT-/),
        category: 'APP_ISSUE',
        subject: 'App problem',
        bookingId: null,
        status: 'OPEN',
        receivedAt: new Date(now).toISOString(),
        ackDueAt: new Date(now + 48 * HOUR).toISOString(),
        resolveDueAt: new Date(now + 30 * DAY).toISOString(),
        acknowledgedAt: null,
        resolvedAt: null,
      });
      const [row] = await e2e.db.sql<Json[]>`
        SELECT raised_by_kind, user_id, contact_phone, is_grievance FROM support_tickets
        WHERE id = ${first.id}`;
      expect(row).toEqual({
        raised_by_kind: 'USER',
        user_id: owner,
        contact_phone: '+919999277101',
        is_grievance: false,
      });
      const [message] = await e2e.db.sql<Json[]>`
        SELECT author_kind, body, is_internal FROM ticket_messages WHERE ticket_id = ${first.id}`;
      expect(message).toEqual({
        author_kind: 'CUSTOMER',
        body: 'The app crashes when I open my photos.',
        is_internal: false,
      });
      const events = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events WHERE event_type = 'ticket.raised'
          AND aggregate_id = ${first.id}`;
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0]?.payload)).not.toContain('crashes');

      e2e.advance(1_000);
      const billing = await asClient(owner, 'POST', '/me/tickets', {
        body: {
          bookingId: paid.id,
          category: 'GRIEVANCE',
          message: 'I was charged twice for this.',
        },
      });
      expect(billing.status).toBe(201);
      expect(billing.json.data).toMatchObject({
        bookingId: paid.id,
        subject: `Grievance · ${paid.reference}`,
      });
      const [grievance] = await e2e.db.sql<{ is_grievance: boolean }[]>`
        SELECT is_grievance FROM support_tickets WHERE id = ${billing.json.data.id}`;
      expect(grievance?.is_grievance).toBe(true);
    });

    it("refuses someone else's booking (404), a short message, and a missing idempotency key", async () => {
      const theirs = await asClient(other, 'POST', '/me/tickets', {
        body: { bookingId: paid.id, category: 'BILLING', message: 'Not my booking at all.' },
      });
      expect([theirs.status, theirs.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      const short = await asClient(owner, 'POST', '/me/tickets', {
        body: { category: 'OTHER', message: 'help' },
      });
      expect([short.status, short.json.error.code]).toEqual([400, 'VALIDATION_FAILED']);
      const long = await asClient(owner, 'POST', '/me/tickets', {
        body: { category: 'OTHER', message: 'x'.repeat(2_001) },
      });
      expect(long.status).toBe(400);
      const noKey = await asClient(owner, 'POST', '/me/tickets', {
        body: { category: 'OTHER', message: 'Retry without a key' },
        key: null,
      });
      expect([noKey.status, noKey.json.error.code]).toEqual([400, 'IDEMPOTENCY_KEY_REQUIRED']);
    });

    it('a retried request replays the same ticket instead of raising another', async () => {
      const key = idem();
      const body = { category: 'OTHER', message: 'Double tap on a slow network.' };
      const a = await asClient(other, 'POST', '/me/tickets', { body, key });
      const b = await asClient(other, 'POST', '/me/tickets', { body, key });
      expect(a.status).toBe(201);
      expect(b.json.data.id).toBe(a.json.data.id);
      const [count] = await e2e.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM support_tickets WHERE user_id = ${other}`;
      expect(count?.n).toBe(1);
    });

    it('at most 5 tickets a day per client (429), counted on the server', async () => {
      for (let i = 0; i < 4; i += 1) {
        const ok = await asClient(other, 'POST', '/me/tickets', {
          body: { category: 'OTHER', message: `Another question number ${i}` },
        });
        expect(ok.status).toBe(201);
      }
      const capped = await asClient(other, 'POST', '/me/tickets', {
        body: { category: 'OTHER', message: 'One question too many today' },
      });
      expect([capped.status, capped.json.error.code]).toEqual([429, 'RATE_LIMITED']);
    });

    it('six at once from one client: exactly five are raised (the cap holds under a race)', async () => {
      const results = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          asClient(racer, 'POST', '/me/tickets', {
            body: { category: 'OTHER', message: `Parallel question number ${i}` },
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 201, 201, 201, 201, 429]);
    });

    it('lists only my tickets, newest first, with status and both deadlines', async () => {
      const res = await asClient(owner, 'GET', '/me/tickets');
      expect(res.status).toBe(200);
      expect(res.json.data.map((t: Json) => t.category)).toEqual(['GRIEVANCE', 'APP_ISSUE']);
      expect(res.json.data[1]).toEqual(first);
      const theirs = await asClient(other, 'GET', '/me/tickets');
      expect(theirs.json.data).toHaveLength(5);
      expect(theirs.json.data.map((t: Json) => t.id)).not.toContain(first.id);
    });
  });

  describe('POST /bookings/:id/quality-issue', () => {
    const report = (userId: string, bookingId: string, key?: string) =>
      asClient(userId, 'POST', `/bookings/${bookingId}/quality-issue`, {
        body: { complaint: 'Half the photos are out of focus.' },
        ...(key ? { key } : {}),
      });

    it("someone else's booking is 404; a booking not delivered is 409", async () => {
      const theirs = await report(other, delivered);
      expect([theirs.status, theirs.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      const early = await report(owner, paid.id as string);
      expect([early.status, early.json.error.code]).toEqual([409, 'BOOKING_NOT_DELIVERED']);
    });

    it('opens the issue for the QM: DELIVERED → QUALITY_ESCALATION by the client, once', async () => {
      const key = idem();
      const res = await report(owner, delivered, key);
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({ bookingId: delivered, status: 'OPEN' });
      const replay = await report(owner, delivered, key);
      expect(replay.json.data.id).toBe(res.json.data.id);
      const [row] = await e2e.db.sql<Json[]>`
        SELECT b.status, q.raised_by_kind, q.raised_by_id FROM bookings b
        JOIN quality_escalations q ON q.booking_id = b.id WHERE b.id = ${delivered}`;
      expect(row).toEqual({
        status: 'QUALITY_ESCALATION',
        raised_by_kind: 'USER',
        raised_by_id: owner,
      });
      const [event] = await e2e.db.sql<{ actor_kind: string }[]>`
        SELECT actor_kind FROM booking_status_events
        WHERE booking_id = ${delivered} AND to_status = 'QUALITY_ESCALATION'`;
      expect(event?.actor_kind).toBe('USER');
      const again = await report(owner, delivered);
      expect([again.status, again.json.error.code]).toEqual([409, 'QUALITY_ISSUE_ALREADY_OPEN']);
      const desk = await e2e.call('GET', '/admin/care/quality', {
        token: await staffToken(e2e, qm),
      });
      expect(desk.json.data.items.map((i: Json) => [i.bookingId, i.raisedByKind])).toContainEqual([
        delivered,
        'USER',
      ]);
    });

    it('two reports at once on one booking: one issue, the other is refused', async () => {
      const results = await Promise.all([report(owner, raced), report(owner, raced)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const [count] = await e2e.db.sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM quality_escalations WHERE booking_id = ${raced}`;
      expect(count?.n).toBe(1);
    });

    it('closes 30 days after delivery', async () => {
      const [b] = await e2e.db.sql<{ delivered_at: Date }[]>`
        SELECT delivered_at FROM bookings WHERE id = ${lateDelivered}`;
      setNow(e2e, new Date((b?.delivered_at.getTime() ?? 0) + 30 * DAY));
      const late = await report(owner, lateDelivered);
      expect([late.status, late.json.error.code]).toEqual([409, 'QUALITY_WINDOW_CLOSED']);
    });
  });
});
