import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { backoffMs } from '../../../infra/outbox/outbox-publisher';
import { JOB } from '../../../infra/queues/queue-names';
import { insertUser } from '../../../test-support/booking-fixtures';
import {
  attemptsOf,
  bookingStatus,
  confirmedBooking,
  drainOutbox,
  eventsOf,
  roundsOf,
} from '../../../test-support/dispatch-fixtures';
import { E2E_SANDBOX_SECRET, type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import type { CaptureResult, ReleaseResult } from '../../payments/gateways/payment-gateway.port';
import { SandboxGateway } from '../../payments/gateways/sandbox.gateway';
import { OffersService } from '../offers.service';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const MIN = 60_000;

/** The sandbox with scripted capture outcomes; counts capture/release calls. */
class SpyGateway extends SandboxGateway {
  captures = 0;
  releases = 0;
  captureResult: CaptureResult = 'CAPTURED';
  override async capture(): Promise<CaptureResult> {
    this.captures += 1;
    return this.captureResult;
  }
  override async releaseAuthorization(): Promise<ReleaseResult> {
    this.releases += 1;
    return 'RELEASED';
  }
}

describe.runIf(TEST_DATABASE_URL)(
  '<3h emergency: authorise, capture on accept, release at T-90',
  () => {
    let e2e: E2eApp;
    let userId: string;
    let clock: Date = NOW;
    const gateway = new SpyGateway(E2E_SANDBOX_SECRET, () => clock);

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'test', gateway });
      userId = await insertUser(e2e.db.sql, '+919811100003');
      // Several opted-in photographers: each accepted booking blocks one of them.
      for (const [n, km] of [
        [301, 3],
        [302, 5],
        [303, 6],
        [304, 7],
      ] as const) {
        await insertPhotographer(e2e.db.sql, {
          phone: proPhone(n),
          km,
          acceptsEmergency: true,
          categories: [{ code: 'FOOD', tier: 'EXPERT' }],
        });
      }
    }, 60_000);

    afterAll(async () => {
      await e2e?.close();
    });

    const advance = (ms: number) => {
      e2e.advance(ms);
      clock = e2e.now();
    };
    const paymentOf = async (paymentId: string) => {
      const [row] = await e2e.db.sql<{ status: string; captured_paise: string }[]>`
      SELECT status, captured_paise FROM payments WHERE id = ${paymentId}`;
      return row;
    };
    const underThreeHours = async () => {
      const start = new Date(e2e.now().getTime() + 2 * 60 * MIN);
      const booking = await confirmedBooking(e2e, userId, start);
      await drainOutbox(e2e);
      return { ...booking, start };
    };
    const acceptOnly = async (bookingId: string) => {
      const [offer] = (await attemptsOf(e2e, bookingId)).filter((a) => a.outcome === 'PENDING');
      if (!offer) throw new Error('no offer');
      return e2e.get(OffersService).accept(offer.photographer_id, offer.id);
    };

    it('an unfilled booking is cancelled at T-90 (UNFILLED) and its authorisation released', async () => {
      const { bookingId, paymentId, start } = await underThreeHours();
      expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
      expect((await roundsOf(e2e, bookingId))[0]).toMatchObject({ is_broadcast: true });
      const deadline = e2e.scheduler
        .pending(JOB.DISPATCH_DEADLINE)
        .filter((j) => j.data.bookingId === bookingId);
      expect(deadline).toHaveLength(1);
      expect(deadline[0]?.at).toEqual(new Date(start.getTime() - 90 * MIN));

      advance(10 * MIN);
      await e2e.runDueJobs(); // the broadcast window closes first
      expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
      expect(await eventsOf(e2e, bookingId)).toContain('dispatch.exhausted');

      advance(20 * MIN); // T-90
      await e2e.runDueJobs();
      expect(await bookingStatus(e2e, bookingId)).toBe('CANCELLED_PRO');
      const [b] = await e2e.db.sql<{ cancellation_reason: string }[]>`
      SELECT cancellation_reason FROM bookings WHERE id = ${bookingId}`;
      expect(b?.cancellation_reason).toBe('UNFILLED');

      await drainOutbox(e2e);
      expect((await paymentOf(paymentId))?.status).toBe('AUTH_RELEASED');
      expect(gateway.releases).toBe(1);
      expect(gateway.captures).toBe(0);
    });

    it('acceptance captures the hold (invoice + ledger); the T-90 job then does nothing', async () => {
      const { bookingId, paymentId, start } = await underThreeHours();
      await acceptOnly(bookingId);
      expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');
      await drainOutbox(e2e);
      const [booking] = await e2e.db.sql<{ total_paise: string; amount_paid_paise: string }[]>`
      SELECT total_paise, amount_paid_paise FROM bookings WHERE id = ${bookingId}`;
      expect(await paymentOf(paymentId)).toEqual({
        status: 'CAPTURED',
        captured_paise: booking?.total_paise,
      });
      expect(booking?.amount_paid_paise).toBe(booking?.total_paise);
      const invoices = await e2e.db.sql<{ purpose: string; total: string }[]>`
      SELECT purpose, total_amount_paise AS total FROM invoices WHERE booking_id = ${bookingId}`;
      expect(invoices).toEqual([{ purpose: 'FULL', total: booking?.total_paise }]);

      advance(start.getTime() - 90 * MIN - e2e.now().getTime());
      await e2e.runDueJobs();
      expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');
    });

    it('a DECLINED capture cancels straight to CANCELLED_CLIENT and releases the hold (ADR-0012 D3)', async () => {
      const { bookingId, paymentId } = await underThreeHours();
      gateway.captureResult = 'DECLINED';
      try {
        await acceptOnly(bookingId);
        await drainOutbox(e2e);
      } finally {
        gateway.captureResult = 'CAPTURED';
      }
      expect(await bookingStatus(e2e, bookingId)).toBe('CANCELLED_CLIENT');
      const [row] = await e2e.db.sql<{ cancellation_reason: string }[]>`
      SELECT cancellation_reason FROM bookings WHERE id = ${bookingId}`;
      expect(row?.cancellation_reason).toBe('CAPTURE_FAILED');
      const [a] = await e2e.db.sql<{ status: string; release_reason: string }[]>`
      SELECT status, release_reason FROM assignments WHERE booking_id = ${bookingId}`;
      expect(a).toEqual({ status: 'RELEASED', release_reason: 'CAPTURE_FAILED' });
      expect((await paymentOf(paymentId))?.status).toBe('AUTH_RELEASED');
      const events = await eventsOf(e2e, bookingId);
      expect(events).not.toContain('booking.redispatching');
      expect(events.indexOf('booking.assigned')).toBeLessThan(
        events.indexOf('booking.cancelled_client'),
      );
    });

    it('an UNKNOWN capture changes nothing and is retried by the outbox until it resolves (ADR-0012 D4)', async () => {
      const { bookingId, paymentId } = await underThreeHours();
      gateway.captureResult = 'UNKNOWN';
      try {
        await acceptOnly(bookingId);
        await drainOutbox(e2e);
      } finally {
        gateway.captureResult = 'CAPTURED';
      }
      expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');
      expect((await paymentOf(paymentId))?.status).toBe('AUTHORIZED');
      const [ev] = await e2e.db.sql<
        { published_at: Date | null; publish_attempts: number; last_error: string }[]
      >`
      SELECT published_at, publish_attempts, last_error FROM domain_events
      WHERE aggregate_id = ${bookingId} AND event_type = 'booking.assigned'`;
      expect(ev).toMatchObject({
        published_at: null,
        publish_attempts: 1,
        last_error: 'dispatch.capture-on-accept: CaptureUnknownError',
      });

      advance(backoffMs(1));
      await drainOutbox(e2e);
      expect((await paymentOf(paymentId))?.status).toBe('CAPTURED');
      expect(await bookingStatus(e2e, bookingId)).toBe('ASSIGNED');
    });
  },
);
