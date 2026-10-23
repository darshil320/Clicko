import type { BookingStatus, CityTier, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { BookingChargeRecord, Db, OnsiteBookingFacts, Tx } from '../bookings.types';
import { hoursFromNumeric } from '../hours';
import type { SnapshotRow } from '../snapshot-row';

/** bigint → text parameter (postgres.js has no bigint parameter type). */
const pg = (paise: bigint): string => paise.toString();

interface FactsRow {
  id: string;
  reference: string;
  status: BookingStatus;
  user_id: string;
  scheduled_start: Date;
  scheduled_end: Date;
  scheduled_hours: string;
  venue_pincode: string;
  venue_location: string | null;
  ruleset_id: string;
  total_paise: string;
  advance_paise: string;
  balance_paise: string;
  actual_check_in: Date | null;
  actual_check_out: Date | null;
  sla_t0: Date | null;
  delivery_due_at: Date | null;
  has_rush: boolean;
  quote_total_paise: string;
  shoot_started_at: Date | null;
  tier: PlanTier;
  city_tier: CityTier;
  category_code: string;
  place_of_supply: string | null;
  payout_share_bps: number;
}

interface ChargeRow {
  booking_id: string;
  sequence: number;
  kind: 'EXTENSION' | 'WAITING';
  minutes: string | null;
  assignment_event_id: string | null;
  taxable_amount_paise: string;
  gst_amount_paise: string;
  cgst: string | null;
  sgst: string | null;
  igst: string | null;
  total_amount_paise: string;
  expected_payout_paise: string;
  computed_at: Date;
}

const big = (v: string | null): bigint => BigInt(v ?? '0');

/**
 * The on-site columns of bookings and the sequence 2+ snapshots (ADR-0013). The RUSH_24H check
 * reads the add-on catalogue read-only (the ADR-0012 catalogue exception).
 */
@Injectable()
export class BookingOnsiteRepository {
  async facts(db: Db, bookingId: string): Promise<OnsiteBookingFacts | null> {
    const [r] = await db<FactsRow[]>`
      SELECT b.id, b.reference, b.status, b.user_id, b.scheduled_start, b.scheduled_end,
             b.scheduled_hours, b.venue_pincode, b.venue_location::text AS venue_location,
             b.ruleset_id, b.total_paise, b.advance_paise, b.balance_paise, b.actual_check_in,
             b.actual_check_out, b.sla_t0, b.delivery_due_at,
             EXISTS (SELECT 1 FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
                     WHERE ba.booking_id = b.id AND a.code = 'RUSH_24H') AS has_rush,
             s.tier, s.city_tier, s.category_code, s.payout_share_bps,
             s.total_amount_paise AS quote_total_paise,
             (SELECT max(e.occurred_at) FROM booking_status_events e
               WHERE e.booking_id = b.id AND e.to_status = 'IN_PROGRESS') AS shoot_started_at,
             s.breakdown->'gst'->>'placeOfSupply' AS place_of_supply
      FROM bookings b
      JOIN booking_price_snapshots s ON s.booking_id = b.id AND s.sequence = 1
      WHERE b.id = ${bookingId}`;
    if (!r) return null;
    if (!r.place_of_supply) throw new Error(`Booking ${bookingId} snapshot has no place of supply`);
    return {
      bookingId: r.id,
      reference: r.reference,
      status: r.status,
      userId: r.user_id,
      scheduledStart: r.scheduled_start,
      scheduledEnd: r.scheduled_end,
      scheduledHours: hoursFromNumeric(r.scheduled_hours),
      venuePincode: r.venue_pincode,
      venueLocation: r.venue_location,
      rulesetId: r.ruleset_id,
      totalPaise: BigInt(r.total_paise),
      advancePaise: BigInt(r.advance_paise),
      balancePaise: BigInt(r.balance_paise),
      quoteTotalPaise: BigInt(r.quote_total_paise),
      shootStartedAt: r.shoot_started_at,
      actualCheckIn: r.actual_check_in,
      actualCheckOut: r.actual_check_out,
      slaT0: r.sla_t0,
      deliveryDueAt: r.delivery_due_at,
      hasRushDelivery: r.has_rush,
      chargeBasis: {
        tier: r.tier,
        cityTier: r.city_tier,
        categoryCode: r.category_code,
        placeOfSupply: r.place_of_supply,
        payoutShareBps: r.payout_share_bps,
      },
    };
  }

  async setActualCheckIn(tx: Tx, bookingId: string, at: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE bookings SET actual_check_in = ${at}
       WHERE id = ${bookingId} AND actual_check_in IS NULL RETURNING id`;
    return rows.length === 1;
  }

  /**
   * Invariant 2: `sla_t0` is set from `actual_check_out` and nothing else — the same value, in the
   * same statement, exactly once.
   */
  async setCheckOut(tx: Tx, bookingId: string, at: Date, deliveryDueAt: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE bookings
         SET actual_check_out = ${at}, sla_t0 = ${at}, delivery_due_at = ${deliveryDueAt}
       WHERE id = ${bookingId} AND actual_check_out IS NULL AND sla_t0 IS NULL
       RETURNING id`;
    return rows.length === 1;
  }

  async nextSequence(tx: Tx, bookingId: string): Promise<number> {
    const [row] = await tx<{ next: number }[]>`
      SELECT coalesce(max(sequence), 0)::int + 1 AS next
      FROM booking_price_snapshots WHERE booking_id = ${bookingId}`;
    return row?.next ?? 1;
  }

  /** The snapshot is new (sequences are never updated, Invariant 3); the advance never moves. */
  async addToTotals(tx: Tx, bookingId: string, amountPaise: bigint): Promise<void> {
    await tx`
      UPDATE bookings
         SET total_paise = total_paise + ${pg(amountPaise)}::bigint,
             balance_paise = balance_paise + ${pg(amountPaise)}::bigint
       WHERE id = ${bookingId}`;
  }

  async insertSnapshot(tx: Tx, bookingId: string, s: SnapshotRow): Promise<void> {
    await tx`
      INSERT INTO booking_price_snapshots (
        booking_id, ruleset_id, ruleset_version, sequence, tier, city_tier, category_code, hours,
        base_rate_per_hour_paise, category_uplift_bps, emergency_multiplier_bps, surge_multiplier_bps,
        night_multiplier_bps, weekend_multiplier_bps, base_amount_paise, addons_amount_paise,
        travel_amount_paise, discount_amount_paise, taxable_amount_paise, gst_rate_bps,
        gst_amount_paise, total_amount_paise, prices_include_gst, payout_share_bps,
        expected_payout_paise, breakdown, promo_code, computed_at)
      VALUES (
        ${bookingId}, ${s.rulesetId}, ${s.rulesetVersion}, ${s.sequence}, ${s.tier}, ${s.cityTier},
        ${s.categoryCode}, ${s.hours}, ${pg(s.baseRatePerHourPaise)}, ${s.categoryUpliftBps},
        ${s.emergencyMultiplierBps}, ${s.surgeMultiplierBps}, ${s.nightMultiplierBps},
        ${s.weekendMultiplierBps}, ${pg(s.baseAmountPaise)}, ${pg(s.addonsAmountPaise)},
        ${pg(s.travelAmountPaise)}, ${pg(s.discountAmountPaise)}, ${pg(s.taxableAmountPaise)},
        ${s.gstRateBps}, ${pg(s.gstAmountPaise)}, ${pg(s.totalAmountPaise)}, ${s.pricesIncludeGst},
        ${s.payoutShareBps}, ${pg(s.expectedPayoutPaise)},
        ${tx.json(s.breakdown as postgres.JSONValue)}, ${s.promoCode}, ${s.computedAt})`;
  }

  async charges(
    db: Db,
    bookingIds: readonly string[],
  ): Promise<Array<BookingChargeRecord & { bookingId: string }>> {
    if (bookingIds.length === 0) return [];
    const rows = await db<ChargeRow[]>`
      SELECT booking_id, sequence, breakdown->>'kind' AS kind, breakdown->>'minutes' AS minutes,
             breakdown->>'assignmentEventId' AS assignment_event_id, taxable_amount_paise,
             gst_amount_paise, breakdown->'gst'->>'cgstPaise' AS cgst,
             breakdown->'gst'->>'sgstPaise' AS sgst, breakdown->'gst'->>'igstPaise' AS igst,
             total_amount_paise, expected_payout_paise, computed_at
      FROM booking_price_snapshots
      WHERE booking_id IN ${db([...new Set(bookingIds)])} AND sequence >= 2
      ORDER BY booking_id, sequence`;
    return rows.map((r) => ({
      bookingId: r.booking_id,
      sequence: r.sequence,
      kind: r.kind,
      minutes: Number(r.minutes ?? '0'),
      assignmentEventId: r.assignment_event_id,
      taxablePaise: BigInt(r.taxable_amount_paise),
      gstPaise: BigInt(r.gst_amount_paise),
      cgstPaise: big(r.cgst),
      sgstPaise: big(r.sgst),
      igstPaise: big(r.igst),
      totalPaise: BigInt(r.total_amount_paise),
      expectedPayoutPaise: BigInt(r.expected_payout_paise),
      computedAt: r.computed_at,
    }));
  }

  /**
   * ASSIGNED / EN_ROUTE bookings that started in [startedAfter, startedBefore] (the no-show
   * sweep). The lower bound keeps rows stuck for hours from starving newer ones.
   */
  async awaitingCheckIn(
    db: Db,
    startedAfter: Date,
    startedBefore: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await db<{ id: string }[]>`
      SELECT id FROM bookings
      WHERE status IN ('ASSIGNED', 'EN_ROUTE')
        AND scheduled_start BETWEEN ${startedAfter} AND ${startedBefore}
      ORDER BY scheduled_start DESC LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }
}
