import { roundHalfUp } from '@clickco/utils';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OutboxSubscribers } from './infra/outbox/outbox-subscribers';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { AcceptanceCaptureService } from './modules/dispatch/acceptance-capture.service';
import type {
  CaptureResult,
  RefundInput,
  RefundResult,
} from './modules/payments/gateways/payment-gateway.port';
import { SandboxGateway } from './modules/payments/gateways/sandbox.gateway';
import { RefundsService } from './modules/refunds/refunds.service';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { E2E_SANDBOX_SECRET, type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import {
  acceptOffer,
  bookAndPay,
  idemKey,
  insertClient,
  setNow,
  tokenFor,
} from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff } from './test-support/staff-fixtures';

/** Monday 15 Mar 2027, 10:00 IST: outside every peak season. */
const NOW = new Date('2027-03-15T04:30:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

/**
 * The sandbox, with the failures a real deployment can meet: a capture still in flight while the
 * booking changes under it, and a process that dies around the gateway refund call.
 */
class ControlledGateway extends SandboxGateway {
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  refundMode: 'NORMAL' | 'DIE_BEFORE_GATEWAY' | 'DIE_AFTER_GATEWAY' = 'NORMAL';
  /** Refunds the "gateway" actually created (what would leave the bank). */
  created = 0;
  /** Captures that reached the gateway. */
  captures = 0;
  /** Receipts the gateway took but does not list yet (a lagging refunds API). */
  private readonly unlisted = new Set<string>();
  /** The next refund is taken but not listed yet; the answer is lost. */
  lagNext = false;

  showAll(): void {
    this.unlisted.clear();
  }

  override async findRefund(providerPaymentId: string, receipt: string) {
    return this.unlisted.has(receipt) ? null : super.findRefund(providerPaymentId, receipt);
  }

  holdCaptures(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  releaseCaptures(): void {
    this.open?.();
    this.gate = null;
  }

  override async capture(providerPaymentId: string, amountPaise: bigint): Promise<CaptureResult> {
    if (this.gate) await this.gate;
    this.captures += 1;
    return super.capture(providerPaymentId, amountPaise);
  }

  override async refund(input: RefundInput): Promise<RefundResult> {
    if (this.refundMode === 'DIE_BEFORE_GATEWAY') throw new Error('process died before the call');
    const result = await super.refund(input);
    this.created += 1;
    if (this.lagNext) {
      this.lagNext = false;
      this.unlisted.add(input.receipt);
      throw new Error('the answer was lost, and the gateway does not list it yet');
    }
    if (this.refundMode === 'DIE_AFTER_GATEWAY') throw new Error('process died after the call');
    return result;
  }
}

/**
 * Security review of client cancellation (S12): races, crashes between the commit and the gateway,
 * money that arrived on an unpaid booking, and the database guard on approver-less refunds.
 */
describe.runIf(TEST_DATABASE_URL)('client cancellation — failure modes and races', () => {
  let e2e: E2eApp;
  let gateway: ControlledGateway;
  let client: string;
  let pro: string;

  const userToken = () => tokenFor(e2e, 'USER', client);
  const quote = async (bookingId: string) =>
    e2e.call('GET', `/bookings/${bookingId}/cancellation`, { token: await userToken() });
  const cancel = async (bookingId: string, expected?: number, key = idemKey('cancel')) =>
    e2e.call('POST', `/bookings/${bookingId}/cancel`, {
      token: await userToken(),
      idempotencyKey: key,
      ...(expected === undefined ? {} : { body: { expectedRefundPaise: expected } }),
    });
  const refundsOf = (bookingId: string) =>
    e2e.db.sql<{ id: string; status: string; amount: string; provider_refund_id: string | null }[]>`
      SELECT id, status, amount_paise::text AS amount, provider_refund_id FROM refunds
      WHERE booking_id = ${bookingId} ORDER BY created_at, id`;
  const statusOf = async (bookingId: string) =>
    (await e2e.db.sql<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${bookingId}`)[0]
      ?.status;
  const reviewsOf = (bookingId: string) =>
    e2e.db.sql<{ reason: string }[]>`
      SELECT payload->>'reason' AS reason FROM domain_events
      WHERE event_type = 'payment.needs_review' AND payload->>'booking_id' = ${bookingId}`;
  const alertsOf = (bookingId: string, source: string) =>
    e2e.db.sql`
      SELECT 1 FROM domain_events WHERE event_type = 'ops.alert'
        AND aggregate_id = ${bookingId} AND payload->>'source_event_type' = ${source}`;
  const sweep = () => e2e.get(JobRegistry).processorFor(JOB.REFUND_SEND_SWEEP)?.process({});

  beforeAll(async () => {
    gateway = new ControlledGateway(E2E_SANDBOX_SECRET, () => e2e.now());
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development', gateway });
    pro = await insertPhotographer(e2e.db.sql, {
      phone: '+919999178101',
      name: 'Kavya Rao',
      km: 2,
      acceptsEmergency: true,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    client = await insertClient(e2e, '+919999278101');
  }, 120_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it('two concurrent cancels under different keys: one cancels, one refund row', async () => {
    const id = (await bookAndPay(e2e, client, plus(NOW, 14 * DAY))).id as string;
    const q = (await quote(id)).json.data;
    const [a, b] = await Promise.all([cancel(id, q.refundPaise), cancel(id, q.refundPaise)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a, b].find((r) => r.status === 409)?.json.error.code).toBe('ALREADY_CANCELLED');
    expect((await refundsOf(id)).map((r) => [r.status, r.amount])).toEqual([
      ['COMPLETED', String(q.refundPaise)],
    ]);
    expect(gateway.created).toBe(1);
  });

  describe('a crash between the commit and the gateway (MEDIUM 2)', () => {
    it('the gateway took it, the answer was lost: the sweep finds it by receipt, no second refund', async () => {
      const id = (await bookAndPay(e2e, client, plus(NOW, 15 * DAY))).id as string;
      const q = (await quote(id)).json.data;
      gateway.refundMode = 'DIE_AFTER_GATEWAY';
      const before = gateway.created;
      const res = await cancel(id, q.refundPaise);
      gateway.refundMode = 'NORMAL';
      // The cancellation committed: the client gets the committed outcome, never a 500.
      expect(res.status).toBe(200);
      expect(res.json.data.cancellation.refundIds).toHaveLength(1);
      expect((await refundsOf(id)).map((r) => [r.status, r.provider_refund_id])).toEqual([
        ['PROCESSING', null],
      ]);
      expect(await alertsOf(id, 'refund.send_failed')).toHaveLength(1);
      expect(gateway.created).toBe(before + 1);
      e2e.advance(3 * MIN);
      await sweep();
      expect((await refundsOf(id)).map((r) => r.status)).toEqual(['COMPLETED']);
      expect(gateway.created).toBe(before + 1);
      await sweep();
      expect(gateway.created).toBe(before + 1);
    });

    it('it never reached the gateway: re-sent once, and only after the safe wait', async () => {
      const id = (await bookAndPay(e2e, client, plus(NOW, 16 * DAY))).id as string;
      const q = (await quote(id)).json.data;
      gateway.refundMode = 'DIE_BEFORE_GATEWAY';
      const before = gateway.created;
      expect((await cancel(id, q.refundPaise)).status).toBe(200);
      gateway.refundMode = 'NORMAL';
      e2e.advance(3 * MIN);
      await sweep(); // nothing at the gateway yet, but it may still appear: look, never send
      expect((await refundsOf(id)).map((r) => r.status)).toEqual(['PROCESSING']);
      expect(gateway.created).toBe(before);
      e2e.advance(15 * MIN);
      await sweep();
      expect((await refundsOf(id)).map((r) => r.status)).toEqual(['COMPLETED']);
      expect(gateway.created).toBe(before + 1);
      e2e.advance(20 * MIN);
      await sweep();
      expect(gateway.created).toBe(before + 1);
    });
  });

  it('a re-send the gateway has not listed yet is not re-sent again on the next sweep', async () => {
    const id = (await bookAndPay(e2e, client, plus(e2e.now(), 17 * DAY))).id as string;
    const q = (await quote(id)).json.data;
    gateway.refundMode = 'DIE_BEFORE_GATEWAY';
    const before = gateway.created;
    expect((await cancel(id, q.refundPaise)).status).toBe(200);
    gateway.refundMode = 'NORMAL';
    e2e.advance(16 * MIN);
    gateway.lagNext = true; // the re-send is taken, its answer lost, and not listed for a while
    await sweep();
    expect(gateway.created).toBe(before + 1);
    expect((await refundsOf(id)).map((r) => r.status)).toEqual(['PROCESSING']);
    const [sent] = await e2e.db.sql<{ last_sent_at: Date }[]>`
      SELECT last_sent_at FROM refunds WHERE booking_id = ${id}`;
    expect(sent?.last_sent_at.getTime()).toBe(e2e.now().getTime());
    // Two minutes on: 18 minutes since the first send, but only 2 since the last one.
    e2e.advance(2 * MIN);
    await sweep();
    expect(gateway.created).toBe(before + 1);
    gateway.showAll();
    e2e.advance(2 * MIN);
    await sweep();
    expect((await refundsOf(id)).map((r) => r.status)).toEqual(['COMPLETED']);
    expect(gateway.created).toBe(before + 1);
  });

  it('refunds still open on the booking are superseded by the ladder refund (domain review)', async () => {
    const id = (await bookAndPay(e2e, client, plus(e2e.now(), 18 * DAY))).id as string;
    const finance = (await bootstrapStaff(e2e, 'finance-cx@clickco.test', 'FINANCE')).id;
    const quality = (await bootstrapStaff(e2e, 'quality-cx@clickco.test', 'QUALITY_MANAGER')).id;
    const [payment] = await e2e.db.sql<{ id: string; captured: string }[]>`
      SELECT id, captured_paise::text AS captured FROM payments WHERE booking_id = ${id}`;
    const captured = Number(payment?.captured ?? '0');
    // A goodwill refund waiting for its second person, and one the gateway failed.
    const [requested] = await e2e.get(RefundsService).request({
      bookingId: id,
      amountPaise: 50_000n,
      reasonCode: 'GOODWILL',
      note: 'Client asked for a discount',
      staffId: quality,
    });
    await e2e.db.sql`
      INSERT INTO refunds (payment_id, booking_id, amount_paise, reason_code, requested_by_kind,
                           requested_by_id, approved_by, approved_at, status, processing_at,
                           attempts, failed_at, failure_reason)
      VALUES (${payment?.id ?? ''}, ${id}, 30_000, 'GOODWILL', 'STAFF', ${quality}, ${finance},
              now(), 'FAILED', now(), 1, now(), 'Refund failed')`;
    // The quote counts the money they would have held: everything paid comes back (> 7 days).
    const q = (await quote(id)).json.data;
    expect(q).toMatchObject({
      band: 'MORE_THAN_7_DAYS',
      paidPaise: captured,
      refundPaise: captured,
    });
    const res = await cancel(id, q.refundPaise);
    expect(res.status).toBe(200);
    const rows = await e2e.db.sql<
      { id: string; status: string; amount: string; rejected_by: string | null; rule: boolean }[]
    >`
      SELECT id, status, amount_paise::text AS amount, rejected_by, rejected_by_rule AS rule
      FROM refunds WHERE booking_id = ${id} ORDER BY created_at, id`;
    const closed = rows.filter((r) => r.status === 'REJECTED');
    expect(closed.map((r) => [r.amount, r.rejected_by, r.rule]).sort()).toEqual(
      [
        ['30000', null, true],
        ['50000', null, true],
      ].sort(),
    );
    expect(closed.map((r) => r.id)).toContain(requested?.id);
    expect(rows.filter((r) => r.status === 'COMPLETED').map((r) => r.amount)).toEqual([
      String(captured),
    ]);
    const rejected = await e2e.db.sql`
      SELECT 1 FROM domain_events WHERE event_type = 'refund.rejected'
        AND payload->>'booking_id' = ${id}`;
    expect(rejected).toHaveLength(2);
  });

  it('money captured on an unpaid booking (after the payment window) comes back in full (LOW 3)', async () => {
    const t = await userToken();
    const created = await e2e.call('POST', '/bookings', {
      token: t,
      idempotencyKey: idemKey('create'),
      body: {
        tier: 'PROFESSIONAL',
        categoryCode: 'FOOD',
        pincode: '395007',
        scheduledStart: plus(e2e.now(), 20 * DAY).toISOString(),
        hours: 2,
        venueAddress: '4 Athwalines, Surat',
        booker: { name: 'Rohan Shah', phone: '+919700000888' },
        modelReleaseConsent: false,
        acceptedTermsVersion: '2.0',
      },
    });
    const id = created.json.data.booking.id as string;
    const pay = await e2e.call('POST', `/bookings/${id}/pay`, {
      token: t,
      idempotencyKey: idemKey('pay'),
    });
    e2e.advance(50 * MIN); // quote expiry (15 min) + the 30-minute grace has passed
    const sim = await e2e.call('POST', `/dev/payments/${pay.json.data.paymentId}/simulate`, {
      body: { outcome: 'CAPTURED' },
    });
    expect(sim.json.data.outcome).not.toBe('APPLIED'); // booked and flagged, not confirmed
    expect(await statusOf(id)).toBe('ADVANCE_PENDING');
    const q = (await quote(id)).json.data;
    expect(q).toMatchObject({
      band: 'BEFORE_PAYMENT',
      paidPaise: pay.json.data.amountPaise,
      refundPaise: pay.json.data.amountPaise,
      keptPaise: 0,
    });
    const res = await cancel(id); // the app's original call: no body
    expect(res.status).toBe(200);
    expect(res.json.data.cancellation).toMatchObject({
      band: 'BEFORE_PAYMENT',
      refundPaise: pay.json.data.amountPaise,
    });
    expect((await refundsOf(id)).map((r) => [r.status, r.amount])).toEqual([
      ['COMPLETED', String(pay.json.data.amountPaise)],
    ]);
  });

  it('the photographer’s share comes from the recorded cancellation, not the event payload (LOW 2)', async () => {
    const start = plus(e2e.now(), 10 * DAY);
    const id = (await bookAndPay(e2e, client, start)).id as string;
    await acceptOffer(e2e, pro, id);
    setNow(e2e, plus(start, -48 * HOUR));
    const q = (await quote(id)).json.data;
    expect(q.band).toBe('HOURS_24_TO_72');
    expect((await cancel(id, q.refundPaise)).status).toBe(200);
    const [event] = await e2e.db.sql<{ event_id: string; payload: Json; occurred_at: Date }[]>`
      SELECT event_id, payload, occurred_at FROM domain_events
      WHERE event_type = 'booking.cancelled_client' AND aggregate_id = ${id}`;
    const handler = e2e
      .get(OutboxSubscribers)
      .subscribersOf('booking.cancelled_client')
      .find((s) => s.name.startsWith('payouts.'));
    if (!event || !handler) throw new Error('missing event or subscriber');
    // A forged payload (as if the outbox row were tampered with) claims everything was kept.
    await handler.handle({
      eventId: event.event_id,
      eventType: 'booking.cancelled_client',
      aggregateKind: 'booking',
      aggregateId: id,
      payload: { ...event.payload, kept_paise: 99_999_999 },
      occurredAt: event.occurred_at,
    });
    const [payout] = await e2e.db.sql<{ basis_bps: number }[]>`
      SELECT basis_bps FROM payouts WHERE booking_id = ${id}`;
    const [b] = await e2e.db.sql<{ total: string }[]>`
      SELECT total_paise::text AS total FROM bookings WHERE id = ${id}`;
    const expectedBps = Number(roundHalfUp(BigInt(q.keptPaise) * 10_000n, BigInt(b?.total ?? '1')));
    expect(payout?.basis_bps).toBe(expectedBps);
    expect(payout?.basis_bps).toBeLessThan(10_000);
  });

  it('a held (<3 h) payment captured while the booking changed is flagged, then refunded (MEDIUM 1)', async () => {
    const start = plus(e2e.now(), 150 * MIN); // HOURS_UNDER_3: authorised only
    const id = (await bookAndPay(e2e, client, start)).id as string;
    expect(await statusOf(id)).toBe('DISPATCHING');
    const proToken = await tokenFor(e2e, 'PHOTOGRAPHER', pro);
    const offers = await e2e.call('GET', '/pro/offers', { token: proToken });
    const offer = (offers.json.data as Json[]).find((o) => o.bookingId === id);
    const accepted = await e2e.call('POST', `/pro/offers/${offer?.attemptId}/accept`, {
      token: proToken,
      idempotencyKey: idemKey('accept'),
    });
    expect(accepted.status).toBe(200);
    // The capture on acceptance starts and hangs at the gateway (outbox not drained yet).
    gateway.holdCaptures();
    const capturing = e2e.get(AcceptanceCaptureService).onAssigned(id);
    await new Promise((r) => setTimeout(r, 50));
    // While it is in flight the app cannot cancel, whatever the status.
    expect((await quote(id)).json.data).toMatchObject({
      cancellable: false,
      blockedBy: 'PAYMENT_SETTLING',
    });
    // A second photographer, so the replacement search has someone to offer (not exhausted).
    await insertPhotographer(e2e.db.sql, {
      phone: '+919999178102',
      name: 'Neel Desai',
      km: 6,
      acceptsEmergency: true,
      categories: [{ code: 'FOOD', tier: 'EXPERT' }],
    });
    const dropped = await e2e.call(
      'POST',
      `/pro/assignments/${accepted.json.data.assignmentId}/cancel`,
      {
        token: proToken,
        idempotencyKey: idemKey('pro-cancel'),
        body: { reason: 'Car broke down' },
      },
    );
    expect(dropped.status).toBe(200);
    expect(await statusOf(id)).toBe('DISPATCHING');
    const blocked = await cancel(id, 0);
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('CANCEL_PAYMENT_SETTLING');
    // The capture lands on a booking nobody holds: booked without an invoice and flagged.
    gateway.releaseCaptures();
    await capturing;
    await drainOutbox(e2e);
    expect((await reviewsOf(id)).map((r) => r.reason)).toContain(
      'HELD_PAYMENT_CAPTURED_WHILE_DISPATCHING',
    );
    const invoices = await e2e.db.sql`SELECT 1 FROM invoices WHERE booking_id = ${id}`;
    expect(invoices).toHaveLength(0);
    // No photographer holds it now: §3.3 before acceptance, everything captured comes back.
    const q = (await quote(id)).json.data;
    expect(q).toMatchObject({
      cancellable: true,
      band: 'EMERGENCY_BEFORE_ACCEPTANCE',
      keptPaise: 0,
    });
    expect(q.refundPaise).toBeGreaterThan(0);
    const res = await cancel(id, q.refundPaise);
    expect(res.status).toBe(200);
    await drainOutbox(e2e);
    expect((await refundsOf(id)).map((r) => [r.status, r.amount])).toEqual([
      ['COMPLETED', String(q.refundPaise)],
    ]);
  });

  it('the capture on acceptance re-checks under the payment lease and does not capture a hold nobody holds', async () => {
    const start = plus(e2e.now(), 150 * MIN); // HOURS_UNDER_3: authorised only
    const id = (await bookAndPay(e2e, client, start)).id as string;
    const capture = e2e.get(AcceptanceCaptureService);
    // The first look (before the lease) saw an accepted booking; under the lease it is not.
    const spy = vi
      .spyOn(capture as unknown as { captureExpected: () => Promise<boolean> }, 'captureExpected')
      .mockResolvedValueOnce(true);
    const before = gateway.captures;
    await capture.onAssigned(id);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(gateway.captures).toBe(before);
    spy.mockRestore();
    const [payment] = await e2e.db.sql<{ status: string }[]>`
      SELECT status FROM payments WHERE booking_id = ${id}`;
    expect(payment?.status).toBe('AUTHORIZED');
  });

  describe('the database and the service guard approver-less refunds (LOW 1)', () => {
    it('a refund at the gateway with no approver must be a rule refund', async () => {
      const id = (await bookAndPay(e2e, client, plus(e2e.now(), 21 * DAY))).id as string;
      const [payment] = await e2e.db.sql<{ id: string }[]>`
        SELECT id FROM payments WHERE booking_id = ${id}`;
      const insert = (kind: string, reason: string) =>
        e2e.db.sql`
          INSERT INTO refunds (payment_id, booking_id, amount_paise, reason_code,
                               requested_by_kind, status, processing_at, attempts)
          VALUES (${payment?.id ?? ''}, ${id}, 100, ${reason}, ${kind}, 'PROCESSING', now(), 1)`;
      await expect(insert('STAFF', 'CLIENT_CANCEL')).rejects.toThrow(/refund_approved_or_by_rule/);
      await expect(insert('USER', 'GOODWILL')).rejects.toThrow(/refund_approved_or_by_rule/);
      // A client's cancellation only: a data-loss refund is the system's, never the client's.
      await expect(insert('USER', 'DATA_LOSS')).rejects.toThrow(/refund_approved_or_by_rule/);
      // A rule refund for a complete data loss (the other allowed rule) passes the guard.
      const allowed = e2e.db.sql.begin(async (tx) => {
        await tx`
          INSERT INTO refunds (payment_id, booking_id, amount_paise, reason_code,
                               requested_by_kind, status, processing_at, attempts)
          VALUES (${payment?.id ?? ''}, ${id}, 100, 'DATA_LOSS', 'SYSTEM', 'PROCESSING', now(), 1)`;
        throw new Error('ROLLBACK_SENTINEL');
      });
      await expect(allowed).rejects.toThrow('ROLLBACK_SENTINEL');
    });

    it('issueByRuleIn refuses a reason outside the rule set and a client who does not own it', async () => {
      const id = (await bookAndPay(e2e, client, plus(e2e.now(), 22 * DAY))).id as string;
      const refunds = e2e.get(RefundsService);
      const other = await insertClient(e2e, '+919999278102');
      const issue = (reasonCode: 'GOODWILL' | 'CLIENT_CANCEL' | 'DATA_LOSS', userId: string) =>
        e2e.db.sql.begin((tx) =>
          refunds.issueByRuleIn(tx, {
            bookingId: id,
            amountPaise: 100n,
            reasonCode,
            note: 'test',
            requestedBy: { kind: 'USER', id: userId },
            rule: 'T&C §3.1',
          }),
        );
      await expect(issue('GOODWILL', client)).rejects.toThrow(/not decided by a rule/);
      await expect(issue('DATA_LOSS', client)).rejects.toThrow(/not decided by a rule/);
      await expect(issue('CLIENT_CANCEL', other)).rejects.toThrow(/does not own/);
      expect(await refundsOf(id)).toEqual([]);
    });
  });
});
