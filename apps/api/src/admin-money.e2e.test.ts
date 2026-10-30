import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendDomainEvent } from './infra/outbox/outbox';
import { RefundDeskService } from './modules/admin/money/refund-desk.service';
import { ReviewDeskService } from './modules/admin/money/review-desk.service';
import { PAYMENT_GATEWAY } from './modules/payments/gateways/payment-gateway.port';
import type { SandboxGateway } from './modules/payments/gateways/sandbox.gateway';
import { SlaDeskService } from './modules/sla/sla-desk.service';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { bookAndPay, insertClient } from './test-support/onsite-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, staffToken } from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
const DAY = 86_400_000;
let keySeq = 0;
const idem = () => `admin-money-${String(++keySeq).padStart(6, '0')}`;

type Who = 'admin' | 'cmMumbai' | 'ops' | 'qm' | 'support' | 'finance' | 'readOnly';

/**
 * ADR-0026 D1/D2 end to end on real paid bookings (sandbox gateway): maker–checker refunds with
 * the QM ceiling, gateway failure + retry, a pending refund settled by webhook, GST credit notes
 * and REFUND_ISSUED postings, client credits, settling review items (incl. an SLA breach remedy
 * and the payout deduction it records), roles, city scope, idempotency and audit rows.
 */
describe.runIf(TEST_DATABASE_URL)('the money desks', () => {
  let e2e: E2eApp;
  const staff = {} as Record<Who, string>;
  const booking = {} as Record<'a' | 'b' | 'c' | 'd' | 'e', Json>;

  const as = async (who: Who) => staffToken(e2e, staff[who]);
  const get = async (who: Who, path: string) => e2e.call('GET', path, { token: await as(who) });
  const post = async (who: Who, path: string, body?: unknown, key = idem()) =>
    e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: key,
      ...(body === undefined ? {} : { body }),
    });
  const money = async (b: Json) =>
    (await get('finance', `/admin/bookings/${b.id}/money`)).json.data;
  const ask = async (who: Who, b: Json, amountPaise: number, reason = 'GOODWILL') =>
    post(who, `/admin/bookings/${b.id}/refunds`, {
      amountPaise,
      reason,
      note: 'Client asked nicely',
    });
  const auditActions = async () =>
    (await e2e.db.sql<{ action: string }[]>`SELECT action FROM audit_logs ORDER BY id`).map(
      (r) => r.action,
    );
  const unbalancedTxns = async () =>
    e2e.db.sql`
      SELECT txn_id FROM ledger_entries GROUP BY txn_id
      HAVING sum(CASE WHEN direction = 'DEBIT' THEN amount_paise ELSE -amount_paise END) <> 0`;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: Who, role: StaffRole, cityId: string | null = null) => {
      staff[key] = (await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId)).id;
    };
    await make('admin', 'SUPER_ADMIN');
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT');
    await make('qm', 'QUALITY_MANAGER');
    await make('support', 'SUPPORT');
    await make('finance', 'FINANCE');
    await make('readOnly', 'READ_ONLY');
    const start = new Date(NOW.getTime() + 6 * DAY);
    booking.a = await bookAndPay(e2e, await insertClient(e2e, '+919700081001'), start);
    booking.b = await bookAndPay(e2e, await insertClient(e2e, '+919700081002'), start);
    booking.c = await bookAndPay(e2e, await insertClient(e2e, '+919700081003'), start);
    booking.d = await bookAndPay(e2e, await insertClient(e2e, '+919700081004'), start);
    booking.e = await bookAndPay(e2e, await insertClient(e2e, '+919700081005'), start);
  }, 180_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('a booking’s money', () => {
    it('shows each payment, what can still go back and the QM limit', async () => {
      const m = await money(booking.a);
      expect(m.payments).toHaveLength(1);
      expect(m.payments[0]).toMatchObject({ purpose: 'ADVANCE', refundedPaise: 0 });
      expect(m.refundablePaise).toBe(m.payments[0].capturedPaise);
      expect(m.qmLimitPaise).toBe(Math.min(500_000, Math.floor(m.totalPaise / 2)));
      // The VPA is masked: it often holds the client's phone number.
      expect(m.payments[0].paidWith).toMatch(/^UPI · .{2}•••@/);
    });

    it('is city-scoped and closed to read-only staff', async () => {
      const other = await get('cmMumbai', `/admin/bookings/${booking.a.id}/money`);
      expect([other.status, other.json.error.code]).toEqual([404, 'BOOKING_NOT_FOUND']);
      expect((await get('readOnly', '/admin/refunds')).status).toBe(403);
      expect((await ask('cmMumbai', booking.a, 100)).status).toBe(404);
    });
  });

  describe('refunds: maker–checker (D1)', () => {
    let r1: Json;

    it('anyone on the floor may ask; never more than is left', async () => {
      const m = await money(booking.a);
      const tooMuch = await ask('ops', booking.a, m.refundablePaise + 1);
      expect([tooMuch.status, tooMuch.json.error.code]).toEqual([409, 'REFUND_TOO_LARGE']);
      const res = await ask('qm', booking.a, 100_000);
      expect(res.status).toBe(201);
      r1 = res.json.data.refunds[0];
      expect(r1).toMatchObject({
        status: 'REQUESTED',
        amountPaise: 100_000,
        reason: 'GOODWILL',
        requestedBy: { id: staff.qm, name: 'Test QUALITY_MANAGER' },
      });
    });

    it('the requester can never approve; ops cannot approve at all', async () => {
      const own = await post('qm', `/admin/refunds/${r1.id}/approve`, {});
      expect([own.status, own.json.error.code]).toEqual([409, 'FOUR_EYES']);
      expect((await post('ops', `/admin/refunds/${r1.id}/approve`, {})).status).toBe(403);
      const queue = await get('qm', '/admin/refunds');
      const mine = queue.json.data.items.find((i: Json) => i.id === r1.id);
      expect(mine).toMatchObject({
        canDecide: false,
        blockedReason: expect.stringMatching(/someone else/),
      });
      const forFinance = await get('finance', '/admin/refunds?status=AWAITING_APPROVAL');
      expect(forFinance.json.data.items.find((i: Json) => i.id === r1.id).canDecide).toBe(true);
    });

    it('finance approves: the gateway refunds, a credit note is issued and REFUND_ISSUED posts', async () => {
      const key = idem();
      const res = await post('finance', `/admin/refunds/${r1.id}/approve`, { note: 'OK' }, key);
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'COMPLETED',
        decidedBy: { id: staff.finance },
        creditNotes: [
          expect.objectContaining({ number: 'CN/2026-27/000001', totalPaise: 100_000 }),
        ],
      });
      const cn = res.json.data.creditNotes[0];
      expect(cn.taxablePaise + cn.cgstPaise + cn.sgstPaise + cn.igstPaise).toBe(100_000);
      expect(cn.cgstPaise - cn.sgstPaise).toBeLessThanOrEqual(1);
      // A retried click replays the answer; the money moved once.
      const replay = await post('finance', `/admin/refunds/${r1.id}/approve`, { note: 'OK' }, key);
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
      const ledger = await e2e.db.sql<
        { account: string; direction: string; amount_paise: string }[]
      >`
        SELECT account, direction, amount_paise FROM ledger_entries
        WHERE refund_id = ${r1.id} AND txn_kind = 'REFUND_ISSUED' ORDER BY id`;
      expect(ledger).toEqual([
        { account: 'REFUNDS_ISSUED', direction: 'DEBIT', amount_paise: String(cn.taxablePaise) },
        {
          account: 'GST_OUTPUT_PAYABLE',
          direction: 'DEBIT',
          amount_paise: String(cn.cgstPaise + cn.sgstPaise + cn.igstPaise),
        },
        { account: 'CASH_GATEWAY', direction: 'CREDIT', amount_paise: '100000' },
      ]);
      const m = await money(booking.a);
      expect(m.payments[0]).toMatchObject({ refundedPaise: 100_000 });
      const [pay] = await e2e.db.sql<{ status: string }[]>`
        SELECT status FROM payments WHERE id = ${m.payments[0].id}`;
      expect(pay?.status).toBe('PARTIALLY_REFUNDED');
    });

    it('the QM approves only within the ceiling (refunds already approved count)', async () => {
      const m = await money(booking.a);
      const over = Math.min(m.qmLimitPaise - 100_000 + 1, m.refundablePaise);
      const req = (await ask('ops', booking.a, over)).json.data.refunds[0];
      const res = await post('qm', `/admin/refunds/${req.id}/approve`, {});
      expect([res.status, res.json.error.code]).toEqual([409, 'ABOVE_LIMIT']);
      const noNote = await post('qm', `/admin/refunds/${req.id}/reject`, {});
      expect(noNote.status).toBe(400);
      const rejected = await post('qm', `/admin/refunds/${req.id}/reject`, { note: 'Not owed' });
      expect(rejected.json.data).toMatchObject({ status: 'REJECTED', decisionNote: 'Not owed' });
      const again = await post('finance', `/admin/refunds/${req.id}/approve`, {});
      expect([again.status, again.json.error.code]).toEqual([409, 'REFUND_ALREADY_DECIDED']);
    });

    it('a failed gateway refund can be retried (new receipt) and then completes', async () => {
      const req = (await ask('ops', booking.a, 10_013)).json.data.refunds[0];
      const failed = await post('finance', `/admin/refunds/${req.id}/approve`, {});
      expect(failed.json.data).toMatchObject({
        status: 'FAILED',
        failureReason: expect.any(String),
      });
      const done = await post('finance', `/admin/refunds/${req.id}/retry`);
      expect(done.json.data).toMatchObject({
        status: 'COMPLETED',
        creditNotes: [expect.objectContaining({ number: 'CN/2026-27/000002' })],
      });
    });

    it('a pending gateway refund completes when the refund webhook arrives', async () => {
      const req = (await ask('ops', booking.a, 10_014)).json.data.refunds[0];
      const pending = await post('finance', `/admin/refunds/${req.id}/approve`, {});
      expect(pending.json.data.status).toBe('PROCESSING');
      const [row] = await e2e.db.sql<{ provider_refund_id: string; provider_payment_id: string }[]>`
        SELECT r.provider_refund_id, p.provider_payment_id FROM refunds r
        JOIN payments p ON p.id = r.payment_id WHERE r.id = ${req.id}`;
      const sandbox = e2e.get<SandboxGateway>(PAYMENT_GATEWAY);
      const hook = sandbox.buildRefundWebhook({
        providerRefundId: row?.provider_refund_id ?? '',
        providerPaymentId: row?.provider_payment_id ?? '',
        amountPaise: 10_014n,
        receipt: req.id,
        event: 'refund.processed',
      });
      const delivered = await e2e.call('POST', '/payments/webhooks/sandbox', {
        rawBody: hook.rawBody,
        headers: { 'x-sandbox-signature': hook.signature, 'x-sandbox-event-id': hook.eventId },
      });
      expect(delivered.status).toBe(200);
      await drainOutbox(e2e);
      const done = await get('finance', '/admin/refunds?status=DONE');
      expect(done.json.data.items.find((i: Json) => i.id === req.id)).toMatchObject({
        status: 'COMPLETED',
      });
    });

    it('keeps the books: every ledger txn balances, credit notes never exceed the invoice', async () => {
      expect(await unbalancedTxns()).toHaveLength(0);
      const over = await e2e.db.sql`
        SELECT i.id FROM invoices i JOIN credit_notes n ON n.invoice_id = i.id
        GROUP BY i.id, i.total_amount_paise HAVING sum(n.total_amount_paise) > i.total_amount_paise`;
      expect(over).toHaveLength(0);
      const m = await money(booking.a);
      expect(m.refundedPaise).toBe(100_000 + 10_013 + 10_014);
      expect(await auditActions()).toEqual(
        expect.arrayContaining([
          'refund.request',
          'refund.approve',
          'refund.reject',
          'refund.retry',
        ]),
      );
    });
  });

  describe('client credits (D2)', () => {
    it('the QM issues within the ceiling, valid 12 months; finance any amount; support never', async () => {
      const ok = await post('qm', `/admin/bookings/${booking.b.id}/credits`, {
        amountPaise: 50_000,
        reason: 'GOODWILL',
        note: 'Sorry for the wait',
      });
      expect(ok.status).toBe(201);
      expect(ok.json.data).toMatchObject({ amountPaise: 50_000, usedPaise: 0, reason: 'GOODWILL' });
      expect(ok.json.data.expiresAt).toBe('2027-12-07T18:29:59.999Z');
      const big = await post('qm', `/admin/bookings/${booking.b.id}/credits`, {
        amountPaise: 500_000,
        reason: 'GOODWILL',
        note: 'Too generous',
      });
      expect([big.status, big.json.error.code]).toEqual([409, 'ABOVE_LIMIT']);
      const fin = await post('finance', `/admin/bookings/${booking.b.id}/credits`, {
        amountPaise: 500_000,
        reason: 'QUALITY',
        note: 'Approved by finance',
      });
      expect(fin.status).toBe(201);
      const support = await post('support', `/admin/bookings/${booking.b.id}/credits`, {
        amountPaise: 100,
        reason: 'GOODWILL',
        note: 'Nope',
      });
      expect(support.status).toBe(403);
      const list = await get('ops', `/admin/credits?bookingId=${booking.b.id}`);
      // Same frozen instant: newest-first falls back to the id, so compare as a set.
      expect(list.json.data.items.map((c: Json) => c.amountPaise).sort()).toEqual([
        50_000, 500_000,
      ]);
      const posted = await e2e.db.sql`
        SELECT 1 FROM ledger_entries WHERE txn_kind = 'CREDIT_ISSUED' AND booking_id = ${booking.b.id}
          AND account = 'CLIENT_CREDITS_LIABILITY'`;
      expect(posted).toHaveLength(2);
    });

    it('an issued credit cannot be changed or withdrawn', async () => {
      await expect(
        e2e.db
          .sql`UPDATE client_credits SET amount_paise = 1 WHERE source_booking_id = ${booking.b.id}`,
      ).rejects.toThrow(/cannot be changed/);
    });
  });

  describe('settling review items (D2)', () => {
    let noShow: string;
    let late: string;
    let breachReview: string;
    let breachId: string;
    const review = async (
      eventType: string,
      bookingId: string,
      payload: Json,
      aggregate = 'booking',
    ) => {
      await e2e.db.sql.begin((tx) =>
        appendDomainEvent(tx, {
          eventType,
          aggregateKind: aggregate,
          aggregateId: aggregate === 'booking' ? bookingId : payload.payment_id,
          occurredAt: e2e.now(),
          payload: { booking_id: bookingId, ...payload },
        }),
      );
      const [row] = await e2e.db.sql<{ event_id: string }[]>`
        SELECT event_id::text FROM domain_events WHERE event_type = ${eventType}
        ORDER BY id DESC LIMIT 1`;
      return row?.event_id ?? '';
    };

    beforeAll(async () => {
      const c = await money(booking.c);
      noShow = await review(
        'payment.needs_review',
        booking.c.id,
        {
          payment_id: c.payments[0].id,
          reason: 'REFUND_DUE_NO_SHOW',
          amount_paise: c.payments[0].capturedPaise,
        },
        'payment',
      );
      late = await review('booking.needs_review', booking.c.id, {
        reason: 'LATE_REPLACEMENT_CREDIT_25',
        credit_bps: 2500,
      });
      const [clock] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO sla_clocks (booking_id, kind, state, anchor_at, due_at, breached_at)
        VALUES (${booking.d.id}, 'DELIVERY_DUE', 'BREACHED', ${NOW}, ${NOW}, ${NOW}) RETURNING id`;
      const [breach] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO sla_breaches (booking_id, clock_id, kind, delay_minutes, band, client_remedy_kind,
                                  client_remedy_paise, payout_deduction_bps, attributed_to)
        VALUES (${booking.d.id}, ${clock?.id ?? ''}, 'DELIVERY_DUE', 600, 'H6_24', 'CREDIT', 30000,
                2500, 'PHOTOGRAPHER') RETURNING id`;
      breachId = breach?.id ?? '';
      breachReview = await review('booking.needs_review', booking.d.id, {
        reason: 'SLA_BREACH_REMEDY',
        breach_id: breachId,
      });
    });

    it('lists open items with booking context and a suggested outcome, in plain words', async () => {
      const res = await get('support', '/admin/reviews');
      expect(res.status).toBe(200);
      const byId = new Map((res.json.data.items as Json[]).map((i) => [i.eventId, i]));
      const c = await money(booking.c);
      expect(byId.get(noShow)).toMatchObject({
        title: 'Photographer did not show up',
        reference: booking.c.reference,
        paymentId: c.payments[0].id,
        suggestion: {
          outcome: 'REFUND_REQUESTED',
          amountPaise: c.payments[0].capturedPaise,
          creditPaise: 50_000,
          refundReason: 'PRO_NO_SHOW',
        },
      });
      expect(byId.get(late)?.suggestion).toMatchObject({ outcome: 'CREDIT_ISSUED' });
      expect(byId.get(breachReview)).toMatchObject({
        title: 'Photos delivered late',
        breach: { id: breachId, owed: true, remedyPaise: 30_000, payoutDeductionBps: 2500 },
        suggestion: { outcome: 'CREDIT_ISSUED', amountPaise: 30_000, creditReason: 'SLA_BREACH' },
      });
      expect((await get('cmMumbai', '/admin/reviews')).json.data.items).toEqual([]);
      expect(await e2e.get(ReviewDeskService).overviewCount('ALL')).toBeGreaterThanOrEqual(3);
    });

    it('settling a no-show requests the refund (four-eyes) and issues the apology credit, once', async () => {
      const item = (await get('finance', '/admin/reviews')).json.data.items.find(
        (i: Json) => i.eventId === noShow,
      );
      const body = {
        outcome: 'REFUND_REQUESTED',
        amountPaise: item.suggestion.amountPaise,
        refundReason: 'PRO_NO_SHOW',
        creditPaise: 50_000,
        note: 'Full refund and ₹500 credit',
      };
      expect((await post('support', `/admin/reviews/${noShow}/settle`, body)).status).toBe(403);
      const res = await post('qm', `/admin/reviews/${noShow}/settle`, body);
      expect(res.status).toBe(200);
      expect(res.json.data.resolution).toMatchObject({
        outcome: 'REFUND_REQUESTED',
        refundIds: [expect.any(String)],
        creditId: expect.any(String),
      });
      const twice = await post('finance', `/admin/reviews/${noShow}/settle`, body);
      expect([twice.status, twice.json.error.code]).toEqual([409, 'REVIEW_ALREADY_SETTLED']);
      const refundId = res.json.data.resolution.refundIds[0];
      expect((await post('qm', `/admin/refunds/${refundId}/approve`, {})).json.error.code).toBe(
        'FOUR_EYES',
      );
      const done = await post('finance', `/admin/refunds/${refundId}/approve`, {});
      expect(done.json.data.status).toBe('COMPLETED');
      const [pay] = await e2e.db.sql<{ status: string }[]>`
        SELECT status FROM payments WHERE id = ${item.paymentId}`;
      expect(pay?.status).toBe('REFUNDED');
    });

    it('a late delivery settles exactly as the table prices it, and records the payout cut', async () => {
      const wrong = await post('qm', `/admin/reviews/${breachReview}/settle`, {
        outcome: 'CREDIT_ISSUED',
        amountPaise: 29_999,
        creditReason: 'SLA_BREACH',
        note: 'Late',
      });
      expect(wrong.json.error.code).toBe('BREACH_REMEDY_FIXED');
      const none = await post('qm', `/admin/reviews/${breachReview}/settle`, {
        outcome: 'NO_ACTION',
        note: 'Skip it',
      });
      expect(none.json.error.code).toBe('BREACH_STILL_OWED');
      const ok = await post('qm', `/admin/reviews/${breachReview}/settle`, {
        outcome: 'CREDIT_ISSUED',
        amountPaise: 30_000,
        creditReason: 'SLA_BREACH',
        note: 'Delivered 10 hours late',
      });
      expect(ok.status).toBe(200);
      expect(ok.json.data.breach).toMatchObject({ owed: false, applied: true });
      const deductions = await e2e.get(SlaDeskService).appliedDeductions([booking.d.id]);
      expect(deductions).toEqual([
        expect.objectContaining({ breachId, bookingId: booking.d.id, payoutDeductionBps: 2500 }),
      ]);
      const events = await e2e.db.sql`
        SELECT 1 FROM domain_events WHERE event_type = 'sla.breach_applied'
          AND payload->>'breach_id' = ${breachId}`;
      expect(events).toHaveLength(1);
    });

    it('no action is a valid outcome; settled items leave the open list', async () => {
      const ok = await post('finance', `/admin/reviews/${late}/settle`, {
        outcome: 'NO_ACTION',
        note: 'Client declined the credit',
      });
      expect(ok.json.data.resolution).toMatchObject({ outcome: 'NO_ACTION', amountPaise: null });
      const open = (await get('finance', '/admin/reviews')).json.data.items.map(
        (i: Json) => i.eventId,
      );
      expect(open).not.toEqual(expect.arrayContaining([noShow]));
      expect(open).not.toContain(late);
      expect(open).not.toContain(breachReview);
      const settled = (await get('finance', '/admin/reviews?status=SETTLED')).json.data.items;
      expect(settled.map((i: Json) => i.eventId)).toEqual(
        expect.arrayContaining([noShow, late, breachReview]),
      );
      expect(await auditActions()).toEqual(
        expect.arrayContaining(['review.settle', 'credit.issue']),
      );
    });

    it('counts refunds awaiting approval for Today', async () => {
      const before = await e2e.get(RefundDeskService).overviewCount('ALL');
      await ask('ops', booking.b, 1_000);
      expect(await e2e.get(RefundDeskService).overviewCount('ALL')).toBe(before + 1);
      expect(await unbalancedTxns()).toHaveLength(0);
    });
  });
  describe('review fixes: breach refunds, webhooks, retries, caps', () => {
    const breachOn = async (b: Json, remedyPaise: number) => {
      const [clock] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO sla_clocks (booking_id, kind, state, anchor_at, due_at, breached_at)
        VALUES (${b.id}, 'DELIVERY_DUE', 'BREACHED', ${NOW}, ${NOW}, ${NOW}) RETURNING id`;
      const [breach] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO sla_breaches (booking_id, clock_id, kind, delay_minutes, band, client_remedy_kind,
                                  client_remedy_paise, payout_deduction_bps, attributed_to)
        VALUES (${b.id}, ${clock?.id ?? ''}, 'DELIVERY_DUE', 2000, 'H24_72', 'PARTIAL_REFUND',
                ${remedyPaise}, 5000, 'PHOTOGRAPHER') RETURNING id`;
      await e2e.db.sql.begin((tx) =>
        appendDomainEvent(tx, {
          eventType: 'booking.needs_review',
          aggregateKind: 'booking',
          aggregateId: b.id,
          occurredAt: e2e.now(),
          payload: { booking_id: b.id, reason: 'SLA_BREACH_REMEDY', breach_id: breach?.id ?? '' },
        }),
      );
      const [row] = await e2e.db.sql<{ event_id: string }[]>`
        SELECT event_id::text FROM domain_events WHERE event_type = 'booking.needs_review'
          AND payload->>'breach_id' = ${breach?.id ?? ''}`;
      return { breachId: breach?.id ?? '', eventId: row?.event_id ?? '' };
    };
    const refundBody = (amountPaise: number, creditPaise?: number) => ({
      outcome: 'REFUND_REQUESTED',
      amountPaise,
      refundReason: 'SLA_BREACH',
      ...(creditPaise ? { creditPaise } : {}),
      note: 'Delivered a day late',
    });
    const applied = async (breachId: string) => {
      const [row] = await e2e.db.sql<{ applied_at: Date | null }[]>`
        SELECT applied_at FROM sla_breaches WHERE id = ${breachId}`;
      return row?.applied_at !== null;
    };

    it('a refund remedy takes no extra credit, and stays owed when its refund is rejected', async () => {
      const { breachId, eventId } = await breachOn(booking.e, 20_000);
      const extra = await post('qm', `/admin/reviews/${eventId}/settle`, refundBody(20_000, 5_000));
      expect(extra.json.error.code).toBe('BREACH_REMEDY_FIXED');
      const ok = await post('qm', `/admin/reviews/${eventId}/settle`, refundBody(20_000));
      expect(ok.status).toBe(200);
      expect(await applied(breachId)).toBe(false);
      expect(await e2e.get(SlaDeskService).appliedDeductions([booking.e.id])).toEqual([]);
      const refundId = ok.json.data.resolution.refundIds[0];
      await post('finance', `/admin/refunds/${refundId}/reject`, {
        note: 'Client was refunded by hand',
      });
      expect(await applied(breachId)).toBe(false);
      expect(await e2e.get(SlaDeskService).appliedDeductions([booking.e.id])).toEqual([]);
    });

    it('a refund remedy is applied (payout cut recorded) when its refund completes', async () => {
      const { breachId, eventId } = await breachOn(booking.b, 20_000);
      const ok = await post('qm', `/admin/reviews/${eventId}/settle`, refundBody(20_000));
      expect(await applied(breachId)).toBe(false);
      const done = await post(
        'finance',
        `/admin/refunds/${ok.json.data.resolution.refundIds[0]}/approve`,
        {},
      );
      expect(done.json.data.status).toBe('COMPLETED');
      expect(await applied(breachId)).toBe(true);
      expect(await e2e.get(SlaDeskService).appliedDeductions([booking.b.id])).toEqual([
        expect.objectContaining({ breachId, payoutDeductionBps: 5000 }),
      ]);
    });

    it('a webhook for a different amount is never booked; it is flagged for review', async () => {
      const req = (await ask('ops', booking.e, 10_014)).json.data.refunds[0];
      const pending = await post('finance', `/admin/refunds/${req.id}/approve`, {});
      expect(pending.json.data.status).toBe('PROCESSING');
      const [row] = await e2e.db.sql<{ provider_refund_id: string; provider_payment_id: string }[]>`
        SELECT r.provider_refund_id, p.provider_payment_id FROM refunds r
        JOIN payments p ON p.id = r.payment_id WHERE r.id = ${req.id}`;
      const hook = e2e.get<SandboxGateway>(PAYMENT_GATEWAY).buildRefundWebhook({
        providerRefundId: row?.provider_refund_id ?? '',
        providerPaymentId: row?.provider_payment_id ?? '',
        amountPaise: 10_015n,
        receipt: req.id,
        event: 'refund.processed',
      });
      await e2e.call('POST', '/payments/webhooks/sandbox', {
        rawBody: hook.rawBody,
        headers: { 'x-sandbox-signature': hook.signature, 'x-sandbox-event-id': hook.eventId },
      });
      await drainOutbox(e2e);
      const flagged = await e2e.db.sql`
        SELECT 1 FROM domain_events WHERE event_type = 'payment.needs_review'
          AND payload->>'reason' = 'REFUND_AMOUNT_MISMATCH' AND payload->>'refund_id' = ${req.id}`;
      expect(flagged).toHaveLength(1);
      const [refund] = await e2e.db.sql<
        { status: string }[]
      >`SELECT status FROM refunds WHERE id = ${req.id}`;
      expect(refund?.status).toBe('PROCESSING');
      const titles = (await get('finance', '/admin/reviews')).json.data.items.map(
        (i: Json) => i.title,
      );
      expect(titles).toContain('Bank refunded a different amount');
    });

    it('a failed refund is not retried once the payment has nothing left for it', async () => {
      const failed = (await ask('ops', booking.d, 10_013)).json.data.refunds[0];
      expect(
        (await post('finance', `/admin/refunds/${failed.id}/approve`, {})).json.data.status,
      ).toBe('FAILED');
      const rest = (await money(booking.d)).refundablePaise;
      const all = (await ask('ops', booking.d, rest)).json.data.refunds[0];
      expect((await post('finance', `/admin/refunds/${all.id}/approve`, {})).json.data.status).toBe(
        'COMPLETED',
      );
      const retry = await post('finance', `/admin/refunds/${failed.id}/retry`);
      expect([retry.status, retry.json.error.code]).toEqual([409, 'REFUND_TOO_LARGE']);
    });

    it('credits and refunds together never exceed the booking total, even for finance', async () => {
      const m = await money(booking.d);
      const left = m.totalPaise - m.refundedPaise - m.creditedPaise;
      const over = await post('finance', `/admin/bookings/${booking.d.id}/credits`, {
        amountPaise: left + 1,
        reason: 'GOODWILL',
        note: 'Too much',
      });
      expect([over.status, over.json.error.code]).toEqual([409, 'CREDIT_TOO_LARGE']);
      expect(await unbalancedTxns()).toHaveLength(0);
    });
  });
});
