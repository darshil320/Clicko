import type { BookingStatus, EmergencyBand, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { EventValue } from '../../../infra/outbox/outbox';
import type { BookingRow, Tx } from '../bookings.types';
import type { AddonRow, SnapshotRow } from '../snapshot-row';
import type { ActorKind } from '../state-machine';

/** bigint → text parameter: postgres.js has no bigint parameter type; Postgres casts to BIGINT. */
const pg = (paise: bigint): string => paise.toString();

export interface NewBooking {
  readonly userId: string;
  readonly cityId: string;
  readonly categoryId: string;
  readonly tier: PlanTier;
  readonly scheduledStart: Date;
  readonly scheduledHours: number;
  readonly emergencyBand: EmergencyBand;
  readonly venuePincode: string;
  readonly venueAddress: string;
  readonly venueLandmark: string | null;
  readonly travelZone: number;
  readonly travelDistanceKm: number | null;
  readonly bookerName: string;
  readonly bookerPhone: string;
  readonly subjectName: string | null;
  readonly subjectPhone: string | null;
  readonly galleryRecipient: 'BOOKER' | 'SUBJECT';
  readonly specialRequirements: string | null;
  readonly rulesetId: string;
  readonly totalPaise: bigint;
  readonly advancePaise: bigint;
  readonly balancePaise: bigint;
  readonly quoteExpiresAt: Date;
  readonly modelReleaseConsent: boolean;
  readonly modelReleaseConsentAt: Date | null;
  readonly createdAt: Date;
}

export interface StatusEventRow {
  readonly bookingId: string;
  readonly from: BookingStatus | null;
  readonly to: BookingStatus;
  readonly actorKind: ActorKind;
  readonly actorId: string | null;
  readonly reason: string | null;
  readonly metadata: Readonly<Record<string, EventValue>> | null;
  readonly occurredAt: Date;
}

interface LockedRow {
  id: string;
  reference: string;
  status: BookingStatus;
  user_id: string;
  emergency_band: EmergencyBand;
  scheduled_start: Date;
  total_paise: string;
  advance_paise: string;
  balance_paise: string;
  amount_paid_paise: string;
  quote_expires_at: Date | null;
}

const toBookingRow = (r: LockedRow): BookingRow => ({
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
});

/** Write path for the tables the bookings module owns. Every method runs inside the caller's tx. */
@Injectable()
export class BookingsRepository {
  async insertBooking(tx: Tx, b: NewBooking): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO bookings (
        user_id, city_id, category_id, tier, scheduled_start, scheduled_hours, emergency_band,
        venue_pincode, venue_address, venue_landmark, travel_zone, travel_distance_km,
        booker_name, booker_phone, subject_name, subject_phone, gallery_recipient, special_requirements,
        ruleset_id, total_paise, advance_paise, balance_paise, quote_expires_at,
        model_release_consent, model_release_consent_at, created_at)
      VALUES (
        ${b.userId}, ${b.cityId}, ${b.categoryId}, ${b.tier}, ${b.scheduledStart}, ${b.scheduledHours},
        ${b.emergencyBand}, ${b.venuePincode}, ${b.venueAddress}, ${b.venueLandmark}, ${b.travelZone},
        ${b.travelDistanceKm}, ${b.bookerName}, ${b.bookerPhone}, ${b.subjectName}, ${b.subjectPhone},
        ${b.galleryRecipient}, ${b.specialRequirements}, ${b.rulesetId}, ${pg(b.totalPaise)},
        ${pg(b.advancePaise)}, ${pg(b.balancePaise)}, ${b.quoteExpiresAt},
        ${b.modelReleaseConsent}, ${b.modelReleaseConsentAt}, ${b.createdAt})
      RETURNING id`;
    if (!row) throw new Error('insertBooking: no row returned');
    return row.id;
  }

  async insertSnapshot(tx: Tx, bookingId: string, s: SnapshotRow): Promise<string> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO booking_price_snapshots (
        booking_id, ruleset_id, ruleset_version, sequence, tier, city_tier, category_code, hours,
        base_rate_per_hour_paise, category_uplift_bps, emergency_multiplier_bps, surge_multiplier_bps,
        night_multiplier_bps, weekend_multiplier_bps, base_amount_paise, addons_amount_paise,
        travel_amount_paise, discount_amount_paise, taxable_amount_paise, gst_rate_bps, gst_amount_paise,
        total_amount_paise, prices_include_gst, payout_share_bps, expected_payout_paise, breakdown,
        promo_code, computed_at)
      VALUES (
        ${bookingId}, ${s.rulesetId}, ${s.rulesetVersion}, ${s.sequence}, ${s.tier}, ${s.cityTier},
        ${s.categoryCode}, ${s.hours}, ${pg(s.baseRatePerHourPaise)}, ${s.categoryUpliftBps},
        ${s.emergencyMultiplierBps}, ${s.surgeMultiplierBps}, ${s.nightMultiplierBps},
        ${s.weekendMultiplierBps}, ${pg(s.baseAmountPaise)}, ${pg(s.addonsAmountPaise)},
        ${pg(s.travelAmountPaise)}, ${pg(s.discountAmountPaise)}, ${pg(s.taxableAmountPaise)},
        ${s.gstRateBps}, ${pg(s.gstAmountPaise)}, ${pg(s.totalAmountPaise)}, ${s.pricesIncludeGst},
        ${s.payoutShareBps}, ${pg(s.expectedPayoutPaise)},
        ${tx.json(s.breakdown as postgres.JSONValue)}, ${s.promoCode}, ${s.computedAt})
      RETURNING id`;
    if (!row) throw new Error('insertSnapshot: no row returned');
    return row.id;
  }

  async insertAddons(tx: Tx, bookingId: string, rows: readonly AddonRow[]): Promise<void> {
    for (const a of rows) {
      await tx`
        INSERT INTO booking_addons (booking_id, addon_id, quantity, amount_paise)
        VALUES (${bookingId}, ${a.addonId}, ${a.quantity}, ${pg(a.amountPaise)})`;
    }
  }

  async insertStatusEvent(tx: Tx, e: StatusEventRow): Promise<void> {
    const metadata = e.metadata === null ? null : tx.json(e.metadata as postgres.JSONValue);
    await tx`
      INSERT INTO booking_status_events
        (booking_id, from_status, to_status, actor_kind, actor_id, reason, metadata, occurred_at)
      VALUES (${e.bookingId}, ${e.from}, ${e.to}, ${e.actorKind}, ${e.actorId}, ${e.reason},
              ${metadata}, ${e.occurredAt})`;
  }

  /** Row lock for the rest of the transaction. null when the booking does not exist. */
  async lock(tx: Tx, bookingId: string): Promise<BookingRow | null> {
    const [row] = await tx<LockedRow[]>`
      SELECT id, reference, status, user_id, emergency_band, scheduled_start, total_paise,
             advance_paise, balance_paise, amount_paid_paise, quote_expires_at
      FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
    return row ? toBookingRow(row) : null;
  }

  async updateStatus(
    tx: Tx,
    bookingId: string,
    to: BookingStatus,
    cancellation: { readonly at: Date; readonly reason: string } | null,
  ): Promise<void> {
    await tx`
      UPDATE bookings
         SET status = ${to},
             cancelled_at = coalesce(${cancellation?.at ?? null}::timestamptz, cancelled_at),
             cancellation_reason = coalesce(${cancellation?.reason ?? null}::text, cancellation_reason)
       WHERE id = ${bookingId}`;
  }

  async addAmountPaid(tx: Tx, bookingId: string, amountPaise: bigint): Promise<void> {
    await tx`
      UPDATE bookings SET amount_paid_paise = amount_paid_paise + ${pg(amountPaise)}::bigint
       WHERE id = ${bookingId}`;
  }
}
