import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOB } from '../../../infra/queues/queue-names';
import { insertUser } from '../../../test-support/booking-fixtures';
import {
  attemptsOf,
  bookingStatus,
  confirmedBooking,
  drainOutbox,
  eventsOf,
} from '../../../test-support/dispatch-fixtures';
import { type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { DispatchTimersService } from '../dispatch-timers.service';
import { OffersService } from '../offers.service';
import { RedispatchService } from '../redispatch.service';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

describe.runIf(TEST_DATABASE_URL)('dispatch deadline for every band (ADR-0012 D1)', () => {
  let e2e: E2eApp;
  let userId: string;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    userId = await insertUser(e2e.db.sql, '+919811100004');
    for (const [n, km] of [
      [401, 2],
      [402, 4],
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

  const reviewReasons = async (bookingId: string) =>
    (
      await e2e.db.sql<{ reason: string }[]>`
        SELECT payload->>'reason' AS reason FROM domain_events
        WHERE event_type = 'payment.needs_review' AND payload->>'booking_id' = ${bookingId}`
    ).map((r) => r.reason);
  const jumpTo = (at: Date) => e2e.advance(at.getTime() - e2e.now().getTime());

  it('a standard booking still unfilled at T-90 is CANCELLED_PRO and its captured advance flagged', async () => {
    const start = new Date(e2e.now().getTime() + 3 * DAY);
    const { bookingId } = await confirmedBooking(e2e, userId, start);
    await drainOutbox(e2e);
    for (const offer of await attemptsOf(e2e, bookingId)) {
      await e2e.get(OffersService).decline(offer.photographer_id, offer.id, 'Busy');
    }
    expect(await eventsOf(e2e, bookingId)).toContain('dispatch.exhausted');
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');

    jumpTo(new Date(start.getTime() - 90 * MIN - 1));
    await e2e.runDueJobs();
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    e2e.advance(1);
    await e2e.runDueJobs();
    expect(await bookingStatus(e2e, bookingId)).toBe('CANCELLED_PRO');
    await drainOutbox(e2e);
    expect(await reviewReasons(bookingId)).toEqual(['REFUND_DUE_UNFILLED']);
    const alerts = await e2e.db.sql<{ severity: string; source: string }[]>`
      SELECT payload->>'severity' AS severity, payload->>'source_event_type' AS source
      FROM domain_events WHERE event_type = 'ops.alert' AND aggregate_id = ${bookingId}`;
    expect(alerts.map((a) => a.source)).toContain('dispatch.exhausted');
  });

  it('the sweeper cancels a booking past its deadline even when its timer job was lost', async () => {
    const start = new Date(e2e.now().getTime() + 4 * DAY);
    const { bookingId } = await confirmedBooking(e2e, userId, start);
    await drainOutbox(e2e);
    // Pretend the deadline job never reached Redis: only the sweep can end this booking.
    for (const j of e2e.scheduler.pending(JOB.DISPATCH_DEADLINE)) {
      if (j.data.bookingId === bookingId) e2e.scheduler.drop(j.jobId);
    }
    jumpTo(new Date(start.getTime() - 89 * MIN));
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    await e2e.get(DispatchTimersService).sweep();
    expect(await bookingStatus(e2e, bookingId)).toBe('CANCELLED_PRO');
  });

  it('a replacement search that starts after the deadline is not cut short by it', async () => {
    const start = new Date(e2e.now().getTime() + 5 * DAY);
    const { bookingId } = await confirmedBooking(e2e, userId, start);
    await drainOutbox(e2e);
    const [offer] = await attemptsOf(e2e, bookingId);
    await e2e.get(OffersService).accept(offer?.photographer_id ?? '', offer?.id ?? '');
    jumpTo(new Date(start.getTime() + 15 * MIN)); // the no-show detector fires (S6)
    await e2e.get(RedispatchService).redispatch(bookingId, 'No check-in', 'NO_SHOW');
    // The other opted-in photographer has the re-broadcast; the past deadline does not cancel it.
    expect((await attemptsOf(e2e, bookingId)).filter((a) => a.outcome === 'PENDING')).toHaveLength(
      1,
    );
    await e2e.get(DispatchTimersService).sweep();
    await e2e.runDueJobs();
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
    expect(
      e2e.scheduler.pending(JOB.DISPATCH_DEADLINE).filter((j) => j.data.bookingId === bookingId),
    ).toEqual([]);
  });
});
