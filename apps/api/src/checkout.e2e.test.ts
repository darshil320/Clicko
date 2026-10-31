import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WEBHOOK_SIGNATURE_LIMIT } from './modules/checkout/webhook-signature-limiter';
import { SandboxGateway } from './modules/payments/gateways/sandbox.gateway';
import { E2E_SANDBOX_SECRET, type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

const createBody = (start: Date, overrides: Json = {}) => ({
  tier: 'PROFESSIONAL',
  categoryCode: 'FOOD',
  pincode: '395007', // Surat
  scheduledStart: start.toISOString(),
  hours: 2,
  venueAddress: '12 Ghod Dod Road, Surat',
  booker: { name: 'Ananya Iyer', phone: '+919999443210' },
  modelReleaseConsent: false,
  acceptedTermsVersion: '2.0',
  ...overrides,
});

describe.runIf(TEST_DATABASE_URL)('checkout end to end (booking → pay → webhook)', () => {
  let e2e: E2eApp;
  let token: string;
  let otherToken: string;
  let bookingId: string;
  let paymentId: string;
  let advancePaise: number;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    token = await e2e.login('+919999443210');
    otherToken = await e2e.login('+919999345678');
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const fiveDaysOut = () => new Date(e2e.now().getTime() + 5 * DAY);

  it('requires an Idempotency-Key to create a booking', async () => {
    const res = await e2e.call('POST', '/bookings', { body: createBody(fiveDaysOut()), token });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('creates a QUOTED booking priced server-side (Professional · Food · Surat, 5 days out)', async () => {
    const res = await e2e.call('POST', '/bookings', {
      body: createBody(fiveDaysOut()),
      token,
      idempotencyKey: 'create-booking-0001',
    });
    expect(res.status).toBe(201);
    const { booking, quote } = res.json.data;
    expect(booking).toMatchObject({
      status: 'QUOTED',
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      cityName: 'Surat',
      emergencyBand: 'NONE',
      amountPaidPaise: 0,
      quoteExpiresAt: new Date(NOW.getTime() + 15 * MINUTE).toISOString(),
    });
    expect(quote).toMatchObject({ kind: 'QUOTE', totalPaise: booking.totalPaise });
    expect(booking.advancePaise).toBe(Math.ceil(booking.totalPaise / 2));
    expect(booking.advancePaise + booking.balancePaise).toBe(booking.totalPaise);
    bookingId = booking.id;
    advancePaise = booking.advancePaise;
  });

  it('replays the same Idempotency-Key with the same booking, and refuses it for another body', async () => {
    const replay = await e2e.call('POST', '/bookings', {
      body: createBody(new Date(NOW.getTime() + 5 * DAY)),
      token,
      idempotencyKey: 'create-booking-0001',
    });
    expect(replay.status).toBe(201);
    expect(replay.json.data.booking.id).toBe(bookingId);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    const rows = await e2e.db.sql`SELECT id FROM bookings`;
    expect(rows).toHaveLength(1);

    const reused = await e2e.call('POST', '/bookings', {
      body: createBody(fiveDaysOut(), { hours: 3 }),
      token,
      idempotencyKey: 'create-booking-0001',
    });
    expect(reused.status).toBe(422);
    expect(reused.json.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('shows the owner a QUOTED detail with its timeline, and nobody else anything', async () => {
    const detail = await e2e.call('GET', `/bookings/${bookingId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.json.data.booking.status).toBe('QUOTED');
    expect(detail.json.data.timeline.map((t: Json) => t.toStatus)).toEqual(['DRAFT', 'QUOTED']);
    expect(detail.json.data.invoices).toEqual([]);

    const theirs = await e2e.call('GET', `/bookings/${bookingId}`, { token: otherToken });
    expect(theirs.status).toBe(404);
    const pay = await e2e.call('POST', `/bookings/${bookingId}/pay`, {
      token: otherToken,
      idempotencyKey: 'other-user-pay-01',
    });
    expect(pay.status).toBe(404);
    expect((await e2e.call('GET', '/bookings', { token: otherToken })).json.data).toEqual([]);
  });

  it('opens the advance payment and returns the same order when asked again', async () => {
    const res = await e2e.call('POST', `/bookings/${bookingId}/pay`, {
      token,
      idempotencyKey: 'pay-booking-0001',
    });
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      gateway: 'SANDBOX',
      amountPaise: advancePaise,
      authorizeOnly: false,
      checkoutKeyId: null,
    });
    paymentId = res.json.data.paymentId;
    const again = await e2e.call('POST', `/bookings/${bookingId}/pay`, {
      token,
      idempotencyKey: 'pay-booking-0002',
    });
    expect(again.json.data.paymentId).toBe(paymentId);
    const detail = await e2e.call('GET', `/bookings/${bookingId}`, { token });
    expect(detail.json.data.booking.status).toBe('ADVANCE_PENDING');
  });

  it('confirms on a captured sandbox webhook: amount paid, ADVANCE invoice, balanced ledger, outbox', async () => {
    const sim = await e2e.call('POST', `/dev/payments/${paymentId}/simulate`, {
      body: { outcome: 'CAPTURED' },
    });
    expect(sim.status).toBe(200);
    expect(sim.json.data.outcome).toBe('APPLIED');

    const { booking, invoices, timeline } = (
      await e2e.call('GET', `/bookings/${bookingId}`, { token })
    ).json.data;
    expect(booking).toMatchObject({ status: 'CONFIRMED', amountPaidPaise: advancePaise });
    expect(timeline.map((t: Json) => t.toStatus)).toEqual([
      'DRAFT',
      'QUOTED',
      'ADVANCE_PENDING',
      'CONFIRMED',
    ]);
    expect(invoices).toHaveLength(1);
    const [inv] = invoices;
    expect(inv).toMatchObject({ purpose: 'ADVANCE', totalPaise: advancePaise, igstPaise: 0 });
    expect(inv.invoiceNumber).toMatch(/^CLK\/26-27\/\d{5}$/);
    expect(inv.taxablePaise + inv.cgstPaise + inv.sgstPaise + inv.igstPaise).toBe(inv.totalPaise);
    expect(inv.cgstPaise - inv.sgstPaise).toBeGreaterThanOrEqual(0);
    expect(inv.cgstPaise - inv.sgstPaise).toBeLessThanOrEqual(1);

    const txns = await e2e.db.sql<{ txn_kind: string; debit: string; credit: string }[]>`
      SELECT txn_kind,
             sum(amount_paise) FILTER (WHERE direction = 'DEBIT') AS debit,
             sum(amount_paise) FILTER (WHERE direction = 'CREDIT') AS credit
      FROM ledger_entries WHERE booking_id = ${bookingId} GROUP BY txn_id, txn_kind ORDER BY txn_kind`;
    expect(txns.map((t) => t.txn_kind)).toEqual(['ADVANCE_CAPTURED', 'GST_ACCRUED']);
    for (const t of txns) expect(t.debit).toBe(t.credit);
    expect(txns[0]?.debit).toBe(String(advancePaise));

    const events = await e2e.db.sql<{ event_type: string }[]>`
      SELECT event_type FROM domain_events WHERE aggregate_id = ${bookingId} ORDER BY id`;
    expect(events.map((e) => e.event_type)).toEqual([
      'booking.drafted',
      'booking.quoted',
      'booking.advance_pending',
      'booking.confirmed',
    ]);
  });

  it('treats replays of a captured webhook as no-ops', async () => {
    const [order] = await e2e.db.sql<{ provider_order_id: string }[]>`
      SELECT provider_order_id FROM payments WHERE id = ${paymentId}`;
    const hook = new SandboxGateway(E2E_SANDBOX_SECRET, () => e2e.now()).buildWebhook({
      providerOrderId: order?.provider_order_id ?? '',
      amountPaise: BigInt(advancePaise),
      event: 'payment.captured',
    });
    const send = () =>
      e2e.call('POST', '/payments/webhooks/sandbox', {
        rawBody: hook.rawBody,
        headers: { 'x-sandbox-signature': hook.signature, 'x-sandbox-event-id': hook.eventId },
      });
    const counts = () => e2e.db.sql<{ ledger: number; invoices: number; paid: string }[]>`
      SELECT (SELECT count(*)::int FROM ledger_entries WHERE booking_id = ${bookingId}) AS ledger,
             (SELECT count(*)::int FROM invoices WHERE booking_id = ${bookingId}) AS invoices,
             (SELECT amount_paid_paise FROM bookings WHERE id = ${bookingId}) AS paid`;
    const [before] = await counts();
    expect(before).toMatchObject({ invoices: 1, paid: String(advancePaise) });
    for (let i = 0; i < 2; i++) {
      const res = await send();
      expect(res.status).toBe(200);
      expect(res.json.data).toEqual({ received: true });
    }
    expect((await counts())[0]).toEqual(before);
    const stored = await e2e.db.sql`
      SELECT 1 FROM payment_webhook_events WHERE provider_event_id LIKE ${`${hook.eventId}#%`}`;
    expect(stored).toHaveLength(1);
  });

  it('rejects a webhook with an invalid signature (400) and counts it', async () => {
    const res = await e2e.call('POST', '/payments/webhooks/sandbox', {
      body: { event: 'payment.captured', payload: {} },
      headers: { 'x-sandbox-signature': 'a'.repeat(64), 'x-sandbox-event-id': 'evt_forged_1' },
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    // Audit M3: a counter per hour, never a row per forged request.
    const [bucket] = await e2e.db.sql<{ n: number }[]>`
      SELECT sum(rejected_count)::int AS n FROM payment_webhook_rejections`;
    expect(bucket?.n).toBe(1);
    const rows = await e2e.db.sql`SELECT 1 FROM payment_webhook_events WHERE NOT signature_valid`;
    expect(rows).toHaveLength(0);
    expect((await e2e.call('POST', '/payments/webhooks/razorpay', { body: {} })).status).toBe(404);
  });

  // Audit M3: the global throttle never drops the gateway's retries; bad signatures are limited
  // per IP (then 429, nothing stored), valid ones never are.
  it('limits bad signatures per IP while valid webhooks keep flowing', async () => {
    const forged = () =>
      e2e.call('POST', '/payments/webhooks/sandbox', {
        body: { event: 'payment.captured', payload: {} },
        headers: { 'x-sandbox-signature': 'b'.repeat(64) },
      });
    const statuses: number[] = [];
    for (let i = 0; i < WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp + 2; i++) {
      statuses.push((await forged()).status);
    }
    // One forged request was already counted by the test above.
    expect(statuses.filter((s) => s === 400)).toHaveLength(
      WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp - 1,
    );
    expect(statuses.slice(-3)).toEqual([429, 429, 429]);
    const [bucket] = await e2e.db.sql<{ n: number }[]>`
      SELECT sum(rejected_count)::int AS n FROM payment_webhook_rejections`;
    expect(bucket?.n).toBe(WEBHOOK_SIGNATURE_LIMIT.maxInvalidPerIp);
    const gateway = new SandboxGateway(E2E_SANDBOX_SECRET, () => e2e.now());
    for (let i = 0; i < 3; i++) {
      const hook = gateway.buildWebhook({
        providerOrderId: `order_unknown_${i}`,
        amountPaise: 100n,
        event: 'payment.captured',
      });
      const res = await e2e.call('POST', '/payments/webhooks/sandbox', {
        rawBody: hook.rawBody,
        headers: { 'x-sandbox-signature': hook.signature, 'x-sandbox-event-id': hook.eventId },
      });
      expect(res.status).toBe(200);
    }
  });

  it('lists the booking for its owner', async () => {
    const res = await e2e.call('GET', '/bookings', { token });
    expect(res.json.data.map((b: Json) => b.id)).toEqual([bookingId]);
  });

  it('refuses to pay an expired quote', async () => {
    const created = await e2e.call('POST', '/bookings', {
      body: createBody(fiveDaysOut()),
      token,
      idempotencyKey: 'create-booking-0002',
    });
    expect(created.status).toBe(201);
    e2e.advance(16 * MINUTE);
    const fresh = await e2e.login('+919999443210'); // the 15-minute access token lapsed too
    const res = await e2e.call('POST', `/bookings/${created.json.data.booking.id}/pay`, {
      token: fresh,
      idempotencyKey: 'pay-expired-0001',
    });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe('QUOTE_EXPIRED');
    token = fresh;
  });

  it('cancels a booking before payment, once', async () => {
    const created = await e2e.call('POST', '/bookings', {
      body: createBody(fiveDaysOut()),
      token,
      idempotencyKey: 'create-booking-0003',
    });
    const id = created.json.data.booking.id;
    const cancel = await e2e.call('POST', `/bookings/${id}/cancel`, {
      token,
      idempotencyKey: 'cancel-booking-01',
    });
    expect(cancel.status).toBe(200);
    expect(cancel.json.data.status).toBe('CANCELLED_CLIENT');
    const again = await e2e.call('POST', `/bookings/${id}/cancel`, {
      token,
      idempotencyKey: 'cancel-booking-02',
    });
    expect(again.status).toBe(409);
    const pay = await e2e.call('POST', `/bookings/${id}/pay`, {
      token,
      idempotencyKey: 'pay-cancelled-01',
    });
    expect(pay.json.error.code).toBe('BOOKING_NOT_PAYABLE');
    const confirmed = await e2e.call('POST', `/bookings/${bookingId}/cancel`, {
      token,
      idempotencyKey: 'cancel-booking-03',
    });
    expect(confirmed.json.error.code).toBe('CANCEL_NOT_AVAILABLE');
  });
});
