import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { PAYMENT_GRACE_MS } from './modules/checkout/payment-flow.service';
import type { E2eApp, Json } from './test-support/e2e-app';
import { startE2eApp } from './test-support/e2e-app';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const HOUR = 60 * 60 * 1000;

const createBody = (start: Date) => ({
  tier: 'PROFESSIONAL',
  categoryCode: 'PORTRAIT',
  pincode: '395007',
  scheduledStart: start.toISOString(),
  hours: 2,
  venueAddress: '4 Athwalines, Surat',
  booker: { name: 'Rohan Shah', phone: '+919999200123' },
  modelReleaseConsent: true,
  acceptedTermsVersion: '2.0',
});

describe.runIf(TEST_DATABASE_URL)(
  'checkout end to end (banded advance, auth-only, failures)',
  () => {
    let e2e: E2eApp;
    let token: string;
    let seq = 0;

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
      token = await e2e.login('+919999200123');
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    const key = (label: string) => `${label}-${String(++seq).padStart(4, '0')}`;

    async function bookAndPay(start: Date): Promise<{ booking: Json; pay: Json }> {
      const created = await e2e.call('POST', '/bookings', {
        body: createBody(start),
        token,
        idempotencyKey: key('create'),
      });
      expect(created.status).toBe(201);
      const booking = created.json.data.booking;
      const pay = await e2e.call('POST', `/bookings/${booking.id}/pay`, {
        token,
        idempotencyKey: key('pay'),
      });
      expect(pay.status).toBe(200);
      return { booking, pay: pay.json.data };
    }

    const simulate = (paymentId: string, outcome: 'CAPTURED' | 'FAILED') =>
      e2e.call('POST', `/dev/payments/${paymentId}/simulate`, { body: { outcome } });

    const detail = async (id: string) =>
      (await e2e.call('GET', `/bookings/${id}`, { token })).json.data;

    it('under 3 hours: authorises the full amount, confirms on authorisation, captures nothing yet', async () => {
      const start = new Date(NOW.getTime() + 2 * HOUR);
      const { booking, pay } = await bookAndPay(start);
      expect(booking).toMatchObject({ emergencyBand: 'HOURS_UNDER_3', balancePaise: 0 });
      expect(pay).toMatchObject({ authorizeOnly: true, amountPaise: booking.totalPaise });

      const sim = await simulate(pay.paymentId, 'CAPTURED');
      expect(sim.json.data).toMatchObject({ event: 'payment.authorized', outcome: 'APPLIED' });

      const d = await detail(booking.id);
      expect(d.booking).toMatchObject({ status: 'CONFIRMED', amountPaidPaise: 0 });
      expect(d.invoices).toEqual([]);
      const [p] = await e2e.db.sql<
        { status: string; purpose: string; is_auth_only: boolean; auth_expires_at: Date }[]
      >`SELECT status, purpose, is_auth_only, auth_expires_at FROM payments WHERE id = ${pay.paymentId}`;
      expect(p).toEqual({
        status: 'AUTHORIZED',
        purpose: 'FULL',
        is_auth_only: true,
        auth_expires_at: new Date(start.getTime() - 90 * 60_000),
      });
      expect(
        await e2e.db.sql`SELECT 1 FROM ledger_entries WHERE booking_id = ${booking.id}`,
      ).toHaveLength(0);
      const [ev] = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events
      WHERE aggregate_id = ${booking.id} AND event_type = 'booking.confirmed'`;
      expect(ev?.payload).toMatchObject({ is_auth_only: true, amount_captured_paise: 0 });
    });

    it('same day: takes 100% up front and the invoice reproduces the snapshot exactly', async () => {
      const start = new Date(NOW.getTime() + 10 * HOUR);
      const { booking, pay } = await bookAndPay(start);
      expect(booking).toMatchObject({ emergencyBand: 'SAME_DAY', balancePaise: 0 });
      expect(pay).toMatchObject({ authorizeOnly: false, amountPaise: booking.totalPaise });
      await simulate(pay.paymentId, 'CAPTURED');

      const d = await detail(booking.id);
      expect(d.booking).toMatchObject({ status: 'CONFIRMED', amountPaidPaise: booking.totalPaise });
      const [inv] = d.invoices;
      const [snap] = await e2e.db.sql<{ taxable: string; gst: string; total: string }[]>`
      SELECT taxable_amount_paise AS taxable, gst_amount_paise AS gst, total_amount_paise AS total
      FROM booking_price_snapshots WHERE booking_id = ${booking.id} AND sequence = 1`;
      expect(inv).toMatchObject({
        purpose: 'FULL',
        taxablePaise: Number(snap?.taxable),
        totalPaise: Number(snap?.total),
      });
      expect(inv.cgstPaise + inv.sgstPaise).toBe(Number(snap?.gst));
    });

    it('a failed attempt leaves the booking ADVANCE_PENDING; paying again reuses the order and succeeds', async () => {
      const { booking, pay } = await bookAndPay(new Date(NOW.getTime() + 5 * 24 * HOUR));
      const failed = await simulate(pay.paymentId, 'FAILED');
      expect(failed.json.data).toMatchObject({ event: 'payment.failed', outcome: 'APPLIED' });
      expect((await detail(booking.id)).booking.status).toBe('ADVANCE_PENDING');
      const [p] = await e2e.db.sql<{ status: string; failure_code: string }[]>`
      SELECT status, failure_code FROM payments WHERE id = ${pay.paymentId}`;
      expect(p).toEqual({ status: 'FAILED', failure_code: 'BAD_REQUEST_ERROR' });

      const retry = await e2e.call('POST', `/bookings/${booking.id}/pay`, {
        token,
        idempotencyKey: key('pay-retry'),
      });
      expect(retry.json.data.paymentId).toBe(pay.paymentId);
      const captured = await simulate(pay.paymentId, 'CAPTURED');
      expect(captured.json.data.outcome).toBe('APPLIED');
      const d = await detail(booking.id);
      expect(d.booking).toMatchObject({
        status: 'CONFIRMED',
        amountPaidPaise: booking.advancePaise,
      });
      expect(d.invoices).toHaveLength(1);
    });

    // Audit L3: an unpaid ADVANCE_PENDING booking is cancelled once its payment window closes,
    // so its promo redemption is free again; one still inside the window is left alone.
    it('the stale-advance sweep cancels unpaid bookings past quote expiry + grace', async () => {
      const { booking: stale } = await bookAndPay(new Date(NOW.getTime() + 6 * 24 * HOUR));
      const [row] = await e2e.db.sql<{ quote_expires_at: Date }[]>`
        SELECT quote_expires_at FROM bookings WHERE id = ${stale.id}`;
      const expires = row?.quote_expires_at.getTime() ?? 0;
      const sweep = async () =>
        e2e.get(JobRegistry).processorFor(JOB.CHECKOUT_STALE_SWEEP)?.process({});
      const statusOf = async () =>
        (
          await e2e.db.sql<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${stale.id}`
        )[0]?.status;
      e2e.advance(expires + PAYMENT_GRACE_MS - 60_000 - e2e.now().getTime());
      await sweep();
      expect(await statusOf()).toBe('ADVANCE_PENDING');
      e2e.advance(2 * 60_000);
      await sweep();
      expect(await statusOf()).toBe('CANCELLED_CLIENT');
      // The clock moved past the access token's life: sign in again.
      token = await e2e.login('+919999200123');
      const events = await e2e.db.sql<{ payload: Json }[]>`
        SELECT payload FROM domain_events
        WHERE event_type = 'booking.cancelled_client' AND aggregate_id = ${stale.id}`;
      expect(events.map((e) => e.payload)).toEqual([
        expect.objectContaining({ reason: 'PAYMENT_WINDOW_EXPIRED' }),
      ]);
      // Paying now is refused: the booking is gone.
      const late = await e2e.call('POST', `/bookings/${stale.id}/pay`, {
        token,
        idempotencyKey: key('pay-late'),
      });
      expect(late.status).toBe(409);
    });

    it('refuses booking endpoints to callers who are not signed in', async () => {
      const res = await e2e.call('POST', '/bookings', {
        body: createBody(new Date(NOW.getTime() + 5 * 24 * HOUR)),
        idempotencyKey: key('anon'),
      });
      expect(res.status).toBe(401);
    });

    it('prices travel from the pincode zone, never from a client-sent distance', async () => {
      const start = new Date(NOW.getTime() + 6 * 24 * HOUR);
      const plain = await e2e.call('POST', '/bookings', {
        body: createBody(start),
        token,
        idempotencyKey: key('travel-plain'),
      });
      const claimed = await e2e.call('POST', '/bookings', {
        body: { ...createBody(start), travelDistanceKm: 250 },
        token,
        idempotencyKey: key('travel-claimed'),
      });
      expect(claimed.status).toBe(201);
      expect(claimed.json.data.booking.totalPaise).toBe(plain.json.data.booking.totalPaise);
      const [row] = await e2e.db.sql<{ km: string | null }[]>`
      SELECT travel_distance_km AS km FROM bookings WHERE id = ${claimed.json.data.booking.id}`;
      expect(row?.km).toBeNull();
    });

    it('rejects a duplicated add-on instead of guessing the quantity', async () => {
      const res = await e2e.call('POST', '/bookings', {
        body: {
          ...createBody(new Date(NOW.getTime() + 5 * 24 * HOUR)),
          addons: [
            { code: 'LIGHTING_KIT', quantity: 1 },
            { code: 'LIGHTING_KIT', quantity: 1 },
          ],
        },
        token,
        idempotencyKey: key('dup-addon'),
      });
      expect(res.status).toBe(422);
      expect(res.json.error.code).toBe('DUPLICATE_ADDON');
    });
  },
);
