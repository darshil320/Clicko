import type { BookingStatus, EmergencyBand, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { BookingView, Db, PromoUsage, SnapshotTotals, TimelineEntry } from '../bookings.types';
import { hoursFromNumeric } from '../hours';
import type { ActorKind } from '../state-machine';

interface ViewRow {
  id: string;
  reference: string;
  status: BookingStatus;
  user_id: string;
  emergency_band: EmergencyBand;
  scheduled_start: Date;
  scheduled_hours: string;
  total_paise: string;
  advance_paise: string;
  balance_paise: string;
  amount_paid_paise: string;
  quote_expires_at: Date | null;
  tier: PlanTier;
  category_code: string;
  city_id: string;
  venue_address: string;
  created_at: Date;
}

const toView = (r: ViewRow): BookingView => ({
  id: r.id,
  reference: r.reference,
  status: r.status,
  userId: r.user_id,
  emergencyBand: r.emergency_band,
  scheduledStart: r.scheduled_start,
  totalPaise: BigInt(r.total_paise),
  advancePaise: BigInt(r.advance_paise),
  balancePaise: BigInt(r.balance_paise),
  amountPaidPaise: BigInt(r.amount_paid_paise),
  quoteExpiresAt: r.quote_expires_at,
  tier: r.tier,
  categoryCode: r.category_code,
  cityId: r.city_id,
  venueAddress: r.venue_address,
  createdAt: r.created_at,
  scheduledHours: hoursFromNumeric(r.scheduled_hours),
});

type Where = postgres.PendingQuery<postgres.Row[]>;

/**
 * Read path. Reads the catalogue (categories, addons) for codes and ids only — read-only
 * reference data, never written from here. City names come from ServiceabilityService.
 */
@Injectable()
export class BookingReadsRepository {
  private async views(db: Db, where: Where): Promise<BookingView[]> {
    const rows = await db<ViewRow[]>`
      SELECT b.id, b.reference, b.status, b.user_id, b.emergency_band, b.scheduled_start,
             b.scheduled_hours, b.total_paise, b.advance_paise, b.balance_paise, b.amount_paid_paise,
             b.quote_expires_at, b.tier, cat.code AS category_code, b.city_id,
             b.venue_address, b.created_at
      FROM bookings b
      JOIN categories cat ON cat.id = b.category_id
      WHERE ${where}
      ORDER BY b.created_at DESC, b.reference DESC`;
    return rows.map(toView);
  }

  async byId(db: Db, bookingId: string): Promise<BookingView | null> {
    const [view] = await this.views(db, db`b.id = ${bookingId}`);
    return view ?? null;
  }

  async byIdForUser(db: Db, userId: string, bookingId: string): Promise<BookingView | null> {
    const [view] = await this.views(db, db`b.id = ${bookingId} AND b.user_id = ${userId}`);
    return view ?? null;
  }

  forUser(db: Db, userId: string): Promise<BookingView[]> {
    return this.views(db, db`b.user_id = ${userId}`);
  }

  async timeline(db: Db, bookingId: string): Promise<TimelineEntry[]> {
    const rows = await db<
      {
        from_status: BookingStatus | null;
        to_status: BookingStatus;
        actor_kind: ActorKind;
        reason: string | null;
        occurred_at: Date;
      }[]
    >`
      SELECT from_status, to_status, actor_kind, reason, occurred_at
      FROM booking_status_events WHERE booking_id = ${bookingId}
      ORDER BY occurred_at, id`;
    return rows.map((r) => ({
      fromStatus: r.from_status,
      toStatus: r.to_status,
      actorKind: r.actor_kind,
      reason: r.reason,
      occurredAt: r.occurred_at,
    }));
  }

  /** Sequence 1 — the quote the client accepted, which the advance invoice is split against. */
  async quoteSnapshotTotals(db: Db, bookingId: string): Promise<SnapshotTotals | null> {
    const [row] = await db<
      {
        base_amount_paise: string;
        addons_amount_paise: string;
        travel_amount_paise: string;
        taxable_amount_paise: string;
        total_amount_paise: string;
        place_of_supply: string | null;
        sac: string | null;
      }[]
    >`
      SELECT base_amount_paise, addons_amount_paise, travel_amount_paise, taxable_amount_paise,
             total_amount_paise, breakdown->'gst'->>'placeOfSupply' AS place_of_supply,
             breakdown->'gst'->>'sac' AS sac
      FROM booking_price_snapshots WHERE booking_id = ${bookingId} AND sequence = 1`;
    if (!row?.place_of_supply || !row.sac) return null;
    const travel = BigInt(row.travel_amount_paise);
    return {
      taxablePaise: BigInt(row.taxable_amount_paise),
      totalPaise: BigInt(row.total_amount_paise),
      subtotalPaise: BigInt(row.base_amount_paise) + BigInt(row.addons_amount_paise) + travel,
      travelPaise: travel,
      placeOfSupply: row.place_of_supply,
      sacCode: row.sac,
    };
  }

  /**
   * A booking holds a redemption (and counts as "a booking" for first-booking promos) unless it
   * never got past a draft, was cancelled, or is a quote that expired unpaid.
   */
  async promoUsage(db: Db, userId: string, promoCode: string, now: Date): Promise<PromoUsage> {
    const holds = db`b.status NOT IN ('DRAFT', 'CANCELLED_CLIENT', 'CANCELLED_PRO')
      AND NOT (b.status = 'QUOTED' AND b.quote_expires_at <= ${now})`;
    const usedCode = db`EXISTS (SELECT 1 FROM booking_price_snapshots s
      WHERE s.booking_id = b.id AND upper(s.promo_code) = upper(${promoCode}))`;
    const [row] = await db<{ user_bookings: number; user_used: number; total_used: number }[]>`
      SELECT
        (SELECT count(*)::int FROM bookings b WHERE b.user_id = ${userId} AND ${holds}) AS user_bookings,
        (SELECT count(*)::int FROM bookings b
          WHERE b.user_id = ${userId} AND ${holds} AND ${usedCode}) AS user_used,
        (SELECT count(*)::int FROM bookings b WHERE ${holds} AND ${usedCode}) AS total_used`;
    return {
      userBookingCount: row?.user_bookings ?? 0,
      userRedemptions: row?.user_used ?? 0,
      totalRedemptions: row?.total_used ?? 0,
    };
  }

  /** Serialises redemptions of one code until the caller's transaction ends. */
  async lockPromoCode(tx: Db, promoCode: string): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`promo:${promoCode.toUpperCase()}`}))`;
  }

  async activeCategoryId(db: Db, code: string): Promise<string | null> {
    const [row] = await db<{ id: string }[]>`
      SELECT id FROM categories WHERE code = ${code} AND is_active`;
    return row?.id ?? null;
  }

  async addonIds(db: Db, codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await db<{ id: string; code: string }[]>`
      SELECT id, code FROM addons WHERE code IN ${db([...codes])}`;
    return new Map(rows.map((r) => [r.code, r.id]));
  }
}
