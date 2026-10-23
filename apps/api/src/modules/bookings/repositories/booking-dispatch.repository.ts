import type { BookingStatus, EmergencyBand, PlanTier } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type {
  AssignmentBookingDetail,
  Db,
  DispatchFacts,
  OfferBookingSummary,
} from '../bookings.types';
import { hoursFromNumeric } from '../hours';

interface FactsRow {
  id: string;
  reference: string;
  status: BookingStatus;
  user_id: string;
  city_id: string;
  category_id: string;
  cert_required_from: PlanTier | null;
  tier: PlanTier;
  scheduled_start: Date;
  scheduled_end: Date;
  emergency_band: EmergencyBand;
  venue_pincode: string;
  venue_location: string | null;
  needs_drone: boolean;
  expected_payout_paise: string;
  ruleset_id: string;
  base_amount_paise: string;
  travel_amount_paise: string;
  payout_share_bps: number;
}

interface SummaryRow {
  id: string;
  reference: string;
  status: BookingStatus;
  category_code: string;
  tier: PlanTier;
  scheduled_start: Date;
  scheduled_hours: string;
  emergency_band: EmergencyBand;
  venue_pincode: string;
  city_id: string;
  booker_name: string;
  expected_payout_paise: string;
}

interface DetailRow extends SummaryRow {
  venue_address: string;
  venue_landmark: string | null;
  special_requirements: string | null;
}

const toSummary = (r: SummaryRow): OfferBookingSummary => ({
  bookingId: r.id,
  reference: r.reference,
  status: r.status,
  categoryCode: r.category_code,
  tier: r.tier,
  scheduledStart: r.scheduled_start,
  scheduledHours: hoursFromNumeric(r.scheduled_hours),
  emergencyBand: r.emergency_band,
  venuePincode: r.venue_pincode,
  cityId: r.city_id,
  bookerName: r.booker_name,
  expectedPayoutPaise: BigInt(r.expected_payout_paise),
});

/** The base booking's payout: snapshot sequence 1 (extensions add their own sequences later). */
const payout = (db: Db) => db`(SELECT s.expected_payout_paise FROM booking_price_snapshots s
  WHERE s.booking_id = b.id AND s.sequence = 1)`;

/**
 * Reads the dispatch module needs about bookings. Catalogue rows (categories, addons) are read-only
 * reference data. `venue_location` leaves as the raw geography text (hex EWKB) — opaque outside
 * dispatch/repositories.
 */
@Injectable()
export class BookingDispatchRepository {
  async facts(db: Db, bookingId: string): Promise<DispatchFacts | null> {
    const [r] = await db<FactsRow[]>`
      SELECT b.id, b.reference, b.status, b.user_id, b.city_id, b.category_id, cat.cert_required_from,
             b.tier, b.scheduled_start, b.scheduled_end, b.emergency_band, b.venue_pincode,
             b.venue_location::text AS venue_location,
             EXISTS (SELECT 1 FROM booking_addons ba JOIN addons a ON a.id = ba.addon_id
                     WHERE ba.booking_id = b.id AND a.requires_drone_credentials) AS needs_drone,
             b.ruleset_id, s.expected_payout_paise, s.base_amount_paise, s.travel_amount_paise,
             s.payout_share_bps
      FROM bookings b
      JOIN categories cat ON cat.id = b.category_id
      JOIN booking_price_snapshots s ON s.booking_id = b.id AND s.sequence = 1
      WHERE b.id = ${bookingId}`;
    if (!r) return null;
    return {
      bookingId: r.id,
      reference: r.reference,
      status: r.status,
      userId: r.user_id,
      cityId: r.city_id,
      categoryId: r.category_id,
      certRequiredFrom: r.cert_required_from,
      tier: r.tier,
      scheduledStart: r.scheduled_start,
      scheduledEnd: r.scheduled_end,
      emergencyBand: r.emergency_band,
      venuePincode: r.venue_pincode,
      venueLocation: r.venue_location,
      needsDroneCredentials: r.needs_drone,
      expectedPayoutPaise: BigInt(r.expected_payout_paise),
      rulesetId: r.ruleset_id,
      payout: {
        baseAmountPaise: BigInt(r.base_amount_paise),
        travelAmountPaise: BigInt(r.travel_amount_paise),
        payoutShareBps: r.payout_share_bps,
        expectedPayoutPaise: BigInt(r.expected_payout_paise),
      },
    };
  }

  /** DISPATCHING bookings starting before `cutoff` — the deadline sweeper's candidates. */
  async dispatchingStartingBefore(db: Db, cutoff: Date, limit: number): Promise<string[]> {
    const rows = await db<{ id: string }[]>`
      SELECT id FROM bookings WHERE status = 'DISPATCHING' AND scheduled_start <= ${cutoff}
      ORDER BY scheduled_start LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }

  /** What an offer may show before acceptance: no address, no phone. */
  async offerSummaries(db: Db, bookingIds: readonly string[]): Promise<OfferBookingSummary[]> {
    if (bookingIds.length === 0) return [];
    const rows = await db<SummaryRow[]>`
      SELECT b.id, b.reference, b.status, cat.code AS category_code, b.tier, b.scheduled_start,
             b.scheduled_hours, b.emergency_band, b.venue_pincode, b.city_id, b.booker_name,
             ${payout(db)} AS expected_payout_paise
      FROM bookings b JOIN categories cat ON cat.id = b.category_id
      WHERE b.id IN ${db([...new Set(bookingIds)])}`;
    return rows.map(toSummary);
  }

  /** After acceptance the photographer needs the address (still no client phone: Invariant 11). */
  async assignmentDetails(
    db: Db,
    bookingIds: readonly string[],
  ): Promise<AssignmentBookingDetail[]> {
    if (bookingIds.length === 0) return [];
    const rows = await db<DetailRow[]>`
      SELECT b.id, b.reference, b.status, cat.code AS category_code, b.tier, b.scheduled_start,
             b.scheduled_hours, b.emergency_band, b.venue_pincode, b.city_id, b.booker_name,
             b.venue_address, b.venue_landmark, b.special_requirements,
             ${payout(db)} AS expected_payout_paise
      FROM bookings b JOIN categories cat ON cat.id = b.category_id
      WHERE b.id IN ${db([...new Set(bookingIds)])}`;
    return rows.map((r) => ({
      ...toSummary(r),
      venueAddress: r.venue_address,
      venueLandmark: r.venue_landmark,
      specialRequirements: r.special_requirements,
    }));
  }
}
