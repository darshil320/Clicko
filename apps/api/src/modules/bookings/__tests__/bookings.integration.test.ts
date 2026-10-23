import { ConflictException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLaunchCities } from '../../../infra/db/seed';
import { seedLaunchRuleset } from '../../../infra/db/seeds/launch-ruleset.seed';
import {
  bookingRequest,
  bookingsService,
  createQuotedBooking,
  insertUser,
  suratCityId,
} from '../../../test-support/booking-fixtures';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import type { PromoInput } from '../../pricing/engine/types';
import type { BookingsService } from '../bookings.service';
import { SYSTEM_ACTOR } from '../bookings.types';

const NOW = new Date('2026-11-10T06:30:00.000Z'); // 12:00 IST
const MINUTE = 60_000;

const FIRST200: PromoInput = {
  code: 'FIRST200',
  discountBps: null,
  discountFlatPaise: 20_000n,
  maxDiscountPaise: null,
  minBookingPaise: 0n,
  appliesToTiers: null,
  appliesToCityIds: null,
  firstBookingOnly: false,
  perUserCap: 5,
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2027-12-31T00:00:00Z'),
  isActive: true,
  userRedemptions: 0,
  userBookingCount: 0,
};

describe.runIf(TEST_DATABASE_URL)('BookingsService in Postgres', () => {
  let db: ScratchDb;
  let service: BookingsService;
  let userId: string;
  let otherUserId: string;

  beforeAll(async () => {
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    await seedLaunchRuleset(db.sql);
    service = bookingsService(db.sql);
    userId = await insertUser(db.sql, '+919876543210');
    otherUserId = await insertUser(db.sql, '+919812345678');
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  const events = (bookingId: string) =>
    db.sql<{ event_type: string; payload: Record<string, unknown> }[]>`
      SELECT event_type, payload FROM domain_events
      WHERE aggregate_kind = 'booking' AND aggregate_id = ${bookingId} ORDER BY id`;

  it('creates the booking at QUOTED with its snapshot, add-ons, timeline and outbox events', async () => {
    const req = bookingRequest({
      addons: [{ code: 'LIGHTING_KIT', quantity: 1 }],
      modelReleaseConsent: true,
    });
    const { view, quote } = await createQuotedBooking(db.sql, userId, NOW, req);

    expect(view).toMatchObject({
      status: 'QUOTED',
      userId,
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      cityId: await suratCityId(db.sql),
      scheduledHours: 2,
      totalPaise: quote.totalPaise,
      advancePaise: quote.advancePaise,
      balancePaise: quote.balancePaise,
      amountPaidPaise: 0n,
      quoteExpiresAt: new Date(NOW.getTime() + 15 * MINUTE),
    });
    expect(view.reference).toMatch(/^CLK-\d+$/);

    const [snap] = await db.sql<
      {
        sequence: number;
        total_amount_paise: string;
        ruleset_version: string;
        breakdown: unknown;
      }[]
    >`SELECT sequence, total_amount_paise, ruleset_version, breakdown FROM booking_price_snapshots
      WHERE booking_id = ${view.id}`;
    expect(snap).toMatchObject({ sequence: 1, total_amount_paise: String(quote.totalPaise) });
    expect(snap?.breakdown).toMatchObject({
      currency: 'INR',
      totalPaise: Number(quote.totalPaise),
    });

    const addons = await db.sql`SELECT quantity FROM booking_addons WHERE booking_id = ${view.id}`;
    expect(addons).toHaveLength(1);

    const [consent] = await db.sql<{ c: boolean; at: Date | null }[]>`
      SELECT model_release_consent AS c, model_release_consent_at AS at FROM bookings WHERE id = ${view.id}`;
    expect(consent).toEqual({ c: true, at: NOW });

    const timeline = await service.timeline(view.id);
    expect(timeline.map((t) => [t.fromStatus, t.toStatus, t.actorKind])).toEqual([
      [null, 'DRAFT', 'USER'],
      ['DRAFT', 'QUOTED', 'SYSTEM'],
    ]);
    const evs = await events(view.id);
    expect(evs.map((e) => e.event_type)).toEqual(['booking.drafted', 'booking.quoted']);
    expect(evs[1]?.payload).toMatchObject({
      booking_id: view.id,
      total_paise: Number(quote.totalPaise),
      advance_paise: Number(quote.advancePaise),
      ruleset_version: '2026.10.01',
    });
  });

  it('never defaults the model-release consent', async () => {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    const [row] = await db.sql<{ c: boolean; at: Date | null }[]>`
      SELECT model_release_consent AS c, model_release_consent_at AS at FROM bookings WHERE id = ${view.id}`;
    expect(row).toEqual({ c: false, at: null });
  });

  it('walks legal transitions and logs each one', async () => {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    await db.sql.begin(async (tx) => {
      await service.transition(tx, {
        bookingId: view.id,
        to: 'ADVANCE_PENDING',
        actor: { kind: 'USER', id: userId },
        occurredAt: NOW,
      });
      await service.transition(tx, {
        bookingId: view.id,
        to: 'CONFIRMED',
        actor: SYSTEM_ACTOR,
        occurredAt: NOW,
        payload: { payment_id: 'p1' },
      });
    });
    expect((await service.findForUser(userId, view.id))?.status).toBe('CONFIRMED');
    expect((await events(view.id)).map((e) => e.event_type)).toEqual([
      'booking.drafted',
      'booking.quoted',
      'booking.advance_pending',
      'booking.confirmed',
    ]);
  });

  it('refuses an illegal transition with 409 and writes nothing', async () => {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    const attempt = db.sql.begin((tx) =>
      service.transition(tx, {
        bookingId: view.id,
        to: 'CONFIRMED',
        actor: SYSTEM_ACTOR,
        occurredAt: NOW,
      }),
    );
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect((await service.timeline(view.id)).map((t) => t.toStatus)).toEqual(['DRAFT', 'QUOTED']);
    expect(await events(view.id)).toHaveLength(2);
  });

  it('records the cancellation reason and time on CANCELLED_CLIENT', async () => {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    await db.sql.begin((tx) =>
      service.transition(tx, {
        bookingId: view.id,
        to: 'CANCELLED_CLIENT',
        actor: { kind: 'USER', id: userId },
        occurredAt: NOW,
        cancellationReason: 'CLIENT_REQUEST',
      }),
    );
    const [row] = await db.sql<
      { status: string; cancelled_at: Date; cancellation_reason: string }[]
    >`
      SELECT status, cancelled_at, cancellation_reason FROM bookings WHERE id = ${view.id}`;
    expect(row).toEqual({
      status: 'CANCELLED_CLIENT',
      cancelled_at: NOW,
      cancellation_reason: 'CLIENT_REQUEST',
    });
  });

  it("hides another user's booking", async () => {
    const { view } = await createQuotedBooking(db.sql, userId, NOW);
    expect(await service.findForUser(otherUserId, view.id)).toBeNull();
    expect((await service.listForUser(otherUserId)).map((b) => b.id)).not.toContain(view.id);
  });

  it('counts promo usage only for bookings that still hold it', async () => {
    const promoUser = await insertUser(db.sql, '+919700000009');
    const used = await createQuotedBooking(db.sql, promoUser, NOW, bookingRequest(), FIRST200);
    await createQuotedBooking(db.sql, promoUser, NOW); // no promo
    expect(await service.promoUsage(promoUser, 'first200', NOW)).toEqual({
      userBookingCount: 2,
      userRedemptions: 1,
      totalRedemptions: 1,
    });
    // Unpaid quotes stop counting once they expire.
    const afterExpiry = new Date(NOW.getTime() + 16 * MINUTE);
    expect(await service.promoUsage(promoUser, 'FIRST200', afterExpiry)).toEqual({
      userBookingCount: 0,
      userRedemptions: 0,
      totalRedemptions: 0,
    });
    // A cancelled booking gives its redemption back.
    await db.sql.begin((tx) =>
      service.transition(tx, {
        bookingId: used.view.id,
        to: 'CANCELLED_CLIENT',
        actor: { kind: 'USER', id: promoUser },
        occurredAt: NOW,
      }),
    );
    expect((await service.promoUsage(promoUser, 'FIRST200', NOW)).userRedemptions).toBe(0);
  });

  it('serialises promo redemptions of one code across concurrent transactions', async () => {
    const order: string[] = [];
    const first = db.sql.begin(async (tx) => {
      await service.promoUsageLocked(tx, userId, 'LOCKME', NOW);
      order.push('first-locked');
      await new Promise((r) => setTimeout(r, 150));
      order.push('first-done');
    });
    await new Promise((r) => setTimeout(r, 30));
    const second = db.sql.begin(async (tx) => {
      await service.promoUsageLocked(tx, otherUserId, 'lockme', NOW);
      order.push('second-locked');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['first-locked', 'first-done', 'second-locked']);
  });

  it('exposes the sequence-1 totals an invoice is split against', async () => {
    const { view, quote } = await createQuotedBooking(db.sql, userId, NOW);
    const totals = await db.sql.begin((tx) => service.quoteSnapshotTotals(tx, view.id));
    expect(totals).toEqual({
      taxablePaise: quote.taxablePaise,
      totalPaise: quote.totalPaise,
      subtotalPaise: quote.subtotalPaise,
      travelPaise: quote.travelAmountPaise,
      placeOfSupply: '24',
      sacCode: '998383',
    });
  });
});
