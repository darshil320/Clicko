import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JOB } from '../../../infra/queues/queue-names';
import { insertUser } from '../../../test-support/booking-fixtures';
import {
  attemptsOf,
  bookingStatus,
  confirmedBooking,
  drainOutbox,
  eventsOf,
  expectedPayout,
  roundsOf,
} from '../../../test-support/dispatch-fixtures';
import { type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { DispatchTimersService } from '../dispatch-timers.service';
import { OffersService } from '../offers.service';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // Tuesday 12:00 IST
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const S = 1000;

describe.runIf(TEST_DATABASE_URL)('dispatch cascade (ADR-0010)', () => {
  let e2e: E2eApp;
  let userId: string;
  const pro: Record<string, string> = {};

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    userId = await insertUser(e2e.db.sql, '+919811100001');
    const food = [{ code: 'FOOD', tier: 'EXPERT' as const }];
    const seed = async (key: string, n: number, km: number, bearing: number, extra = {}) => {
      pro[key] = await insertPhotographer(e2e.db.sql, {
        phone: proPhone(n),
        name: key,
        km,
        bearing,
        categories: food,
        ...extra,
      });
    };
    await seed('p1', 1, 2, 0, { acceptsEmergency: true });
    await seed('p2', 2, 4, 90);
    await seed('p3', 3, 6, 180);
    await seed('p4', 4, 7, 270);
    await seed('p5', 5, 12, 45, { acceptsEmergency: true });
    await seed('p6', 6, 20, 135);
    await seed('p7', 7, 40, 225, { radiusKm: 50 });
    await seed('p8', 8, 12, 315, { drone: 'BOTH' });
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const names = (ids: readonly string[]) =>
    ids.map((id) => Object.entries(pro).find(([, v]) => v === id)?.[0] ?? id);
  const waveOf = async (bookingId: string, wave: number) =>
    (await attemptsOf(e2e, bookingId)).filter((a) => a.wave === wave);
  const expire = async (seconds: number) => {
    e2e.advance(seconds * S);
    await e2e.runDueJobs();
  };

  describe('a standard booking walks all four waves', () => {
    let bookingId: string;

    it('booking.confirmed → DISPATCHING and wave 1: top 3 within 8 km, 120 s', async () => {
      ({ bookingId } = await confirmedBooking(e2e, userId, new Date(NOW.getTime() + 5 * DAY)));
      await drainOutbox(e2e);
      expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
      const [round] = await roundsOf(e2e, bookingId);
      expect(round).toMatchObject({
        wave: 1,
        radius_km: 8,
        candidate_count: 3,
        window_seconds: 120,
        is_broadcast: false,
        ended_at: null,
      });
      const offers = await waveOf(bookingId, 1);
      expect(names(offers.map((a) => a.photographer_id))).toEqual(['p1', 'p2', 'p3']);
      expect(offers[0]?.rank_score).toBeGreaterThan(offers[2]?.rank_score ?? 1);
      const payout = await expectedPayout(e2e, bookingId);
      for (const a of offers) {
        expect(a).toMatchObject({ outcome: 'PENDING', offered_payout_paise: payout });
        expect(a.expires_at).toEqual(new Date(NOW.getTime() + 120 * S));
      }
      const timers = e2e.scheduler.pending(JOB.DISPATCH_WAVE_EXPIRY);
      expect(timers).toHaveLength(1);
      expect(timers[0]).toMatchObject({ data: { roundId: round?.id }, at: offers[0]?.expires_at });
      expect(await eventsOf(e2e, bookingId)).toEqual(
        expect.arrayContaining([
          'booking.confirmed',
          'booking.dispatching',
          'dispatch.wave_opened',
        ]),
      );
    });

    it('a re-delivered booking.confirmed opens nothing new (idempotent subscriber)', async () => {
      await e2e.db.sql`UPDATE domain_events SET published_at = NULL
                       WHERE aggregate_id = ${bookingId} AND event_type = 'booking.confirmed'`;
      expect((await e2e.publish()).published).toBe(1);
      expect(await roundsOf(e2e, bookingId)).toHaveLength(1);
      expect(e2e.scheduler.pending(JOB.DISPATCH_WAVE_EXPIRY)).toHaveLength(1);
    });

    it('a wave-expiry job that fires early is a no-op that re-arms itself under a fresh job id', async () => {
      const [round] = await roundsOf(e2e, bookingId);
      e2e.advance(60 * S);
      await e2e.get(DispatchTimersService).expireRound(round?.id ?? '');
      expect((await roundsOf(e2e, bookingId))[0]?.ended_at).toBeNull();
      const timers = e2e.scheduler.pending(JOB.DISPATCH_WAVE_EXPIRY);
      expect(timers).toHaveLength(2);
      expect(timers[1]?.jobId).toMatch(/-r[0-9a-f-]{36}$/);
      expect(timers[1]?.at).toEqual(timers[0]?.at);
      e2e.advance(-60 * S);
    });

    it('every booking gets a deadline timer at start − 90 min (ADR-0012 D1)', async () => {
      const deadline = e2e.scheduler
        .pending(JOB.DISPATCH_DEADLINE)
        .find((j) => j.data.bookingId === bookingId);
      expect(deadline?.at).toEqual(new Date(NOW.getTime() + 5 * DAY - 90 * 60 * S));
    });

    it('wave 1 expires → its offers EXPIRE and wave 2 goes to the next 5 within 15 km', async () => {
      await expire(120);
      const rounds = await roundsOf(e2e, bookingId);
      expect(rounds[0]).toMatchObject({ outcome: 'EXHAUSTED' });
      expect(rounds[1]).toMatchObject({ wave: 2, radius_km: 15, window_seconds: 120 });
      expect((await waveOf(bookingId, 1)).map((a) => a.outcome)).toEqual([
        'EXPIRED',
        'EXPIRED',
        'EXPIRED',
      ]);
      expect(names((await waveOf(bookingId, 2)).map((a) => a.photographer_id)).sort()).toEqual([
        'p4',
        'p5',
        'p8',
      ]);
    });

    it('when every offer in a wave is declined, the next wave opens at once', async () => {
      const offers = e2e.get(OffersService);
      for (const a of await waveOf(bookingId, 2)) {
        await offers.decline(a.photographer_id, a.id, 'Too far');
      }
      const rounds = await roundsOf(e2e, bookingId);
      expect(rounds[1]).toMatchObject({ outcome: 'EXHAUSTED' });
      expect(rounds[2]).toMatchObject({ wave: 3, radius_km: 25, window_seconds: 180 });
      expect(names((await waveOf(bookingId, 3)).map((a) => a.photographer_id))).toEqual(['p6']);
      expect((await waveOf(bookingId, 2)).every((a) => a.decline_reason === 'Too far')).toBe(true);
    });

    it('wave 3 expires → wave 4 is city-wide (own service radius only), 300 s', async () => {
      await expire(180);
      const rounds = await roundsOf(e2e, bookingId);
      expect(rounds[3]).toMatchObject({ wave: 4, radius_km: 100, window_seconds: 300 });
      expect(names((await waveOf(bookingId, 4)).map((a) => a.photographer_id))).toEqual(['p7']);
    });

    it('wave 4 expires → dispatch.exhausted; the booking stays DISPATCHING for the ops desk', async () => {
      await expire(300);
      expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
      const rounds = await roundsOf(e2e, bookingId);
      expect(rounds).toHaveLength(4);
      expect(rounds.every((r) => r.ended_at !== null)).toBe(true);
      expect(
        (await eventsOf(e2e, bookingId)).filter((e) => e === 'dispatch.exhausted'),
      ).toHaveLength(1);
      expect(e2e.scheduler.pending(JOB.DISPATCH_WAVE_EXPIRY)).toEqual([]);
    });
  });

  it('records an empty wave and moves straight on (DRONE add-on: approved documents only)', async () => {
    const { bookingId } = await confirmedBooking(e2e, userId, new Date(NOW.getTime() + 6 * DAY), {
      addons: [{ code: 'DRONE', quantity: 1 }],
    });
    await drainOutbox(e2e);
    const rounds = await roundsOf(e2e, bookingId);
    expect(rounds[0]).toMatchObject({ wave: 1, candidate_count: 0, outcome: 'EXHAUSTED' });
    expect(rounds[1]).toMatchObject({ wave: 2, candidate_count: 1, ended_at: null });
    expect(names((await waveOf(bookingId, 2)).map((a) => a.photographer_id))).toEqual(['p8']);
  });

  it('emergency bands broadcast once to every opted-in photographer for 10 minutes', async () => {
    const { bookingId } = await confirmedBooking(e2e, userId, new Date(NOW.getTime() + 10 * HOUR));
    await drainOutbox(e2e);
    const [round] = await roundsOf(e2e, bookingId);
    expect(round).toMatchObject({
      wave: 1,
      is_broadcast: true,
      radius_km: 100,
      window_seconds: 600,
      candidate_count: 2,
    });
    expect(names((await waveOf(bookingId, 1)).map((a) => a.photographer_id))).toEqual(['p1', 'p5']);
    await expire(600);
    const rounds = await roundsOf(e2e, bookingId);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]?.outcome).toBe('EXHAUSTED');
    expect(await eventsOf(e2e, bookingId)).toContain('dispatch.exhausted');
    expect(await bookingStatus(e2e, bookingId)).toBe('DISPATCHING');
  });
});
