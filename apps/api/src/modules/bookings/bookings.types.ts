import type {
  BookingStatus,
  CreateBookingRequest,
  EmergencyBand,
  PlanTier,
} from '@clickco/contracts';
import type postgres from 'postgres';
import type { EventValue } from '../../infra/outbox/outbox';
import type { Quote } from '../pricing/engine/types';
import type { ActorKind } from './state-machine';

/** A plain connection or an open transaction: reads accept either. */
export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export interface Actor {
  readonly kind: ActorKind;
  readonly id: string | null;
}

export const SYSTEM_ACTOR: Actor = { kind: 'SYSTEM', id: null };

/** The bookings row as checkout decides on it. Money is bigint paise. */
export interface BookingRow {
  readonly id: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly userId: string;
  readonly emergencyBand: EmergencyBand;
  readonly scheduledStart: Date;
  readonly totalPaise: bigint;
  readonly advancePaise: bigint;
  readonly balancePaise: bigint;
  readonly amountPaidPaise: bigint;
  readonly quoteExpiresAt: Date | null;
}

/** A booking as shown to its owner (BookingSummary before the wire mapping). */
export interface BookingView extends BookingRow {
  readonly tier: PlanTier;
  readonly categoryCode: string;
  /** Display names come from ServiceabilityService: bookings never reads the cities table. */
  readonly cityId: string;
  readonly scheduledHours: number;
  readonly venueAddress: string;
  readonly createdAt: Date;
}

export interface CreateQuotedInput {
  readonly userId: string;
  readonly request: CreateBookingRequest;
  readonly cityId: string;
  /** The engine's quote, priced server-side for this user moments ago. */
  readonly quote: Quote;
  readonly now: Date;
}

export interface TransitionInput {
  readonly bookingId: string;
  readonly to: BookingStatus;
  readonly actor: Actor;
  readonly occurredAt: Date;
  readonly reason?: string;
  /** Stored on the booking_status_events row (evidence pack). */
  readonly metadata?: Readonly<Record<string, EventValue>>;
  /** Event-specific fields for the outbox payload (DOMAIN §3). */
  readonly payload?: Readonly<Record<string, EventValue>>;
  /** Only for CANCELLED_* transitions. */
  readonly cancellationReason?: string;
}

/** The quote snapshot facts an invoice is split against (sequence 1). */
export interface SnapshotTotals {
  readonly taxablePaise: bigint;
  readonly totalPaise: bigint;
  /** base + addons + travel, before discount. */
  readonly subtotalPaise: bigint;
  readonly travelPaise: bigint;
  readonly placeOfSupply: string;
  readonly sacCode: string;
}

/** What the promo checks need about this user and code (doc 05 step 11). */
export interface PromoUsage {
  readonly userBookingCount: number;
  readonly userRedemptions: number;
  readonly totalRedemptions: number;
}

export interface TimelineEntry {
  readonly fromStatus: BookingStatus | null;
  readonly toStatus: BookingStatus;
  readonly actorKind: ActorKind;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

/** What dispatch needs to find and rank photographers for a booking (ADR-0010). */
export interface DispatchFacts {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly userId: string;
  readonly cityId: string;
  readonly categoryId: string;
  /** categories.cert_required_from (catalogue). */
  readonly certRequiredFrom: PlanTier | null;
  readonly tier: PlanTier;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly emergencyBand: EmergencyBand;
  readonly venuePincode: string;
  /** Geography as Postgres prints it (hex EWKB); null until venues are geocoded (S11). */
  readonly venueLocation: string | null;
  /** A booked add-on requires DGCA drone credentials. */
  readonly needsDroneCredentials: boolean;
  /** Snapshot sequence 1 expected_payout_paise. */
  readonly expectedPayoutPaise: bigint;
  /** The ruleset the booking was priced on (its auto-cancel point comes from here). */
  readonly rulesetId: string;
  /** Snapshot sequence 1 payout inputs (the no-show incentive is computed by pricing). */
  readonly payout: {
    readonly baseAmountPaise: bigint;
    readonly travelAmountPaise: bigint;
    readonly payoutShareBps: number;
    readonly expectedPayoutPaise: bigint;
  };
}

/** A booking as an offer may show it: no address, no phone. */
export interface OfferBookingSummary {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: BookingStatus;
  readonly categoryCode: string;
  readonly tier: PlanTier;
  readonly scheduledStart: Date;
  readonly scheduledHours: number;
  readonly emergencyBand: EmergencyBand;
  readonly venuePincode: string;
  readonly cityId: string;
  readonly bookerName: string;
  readonly expectedPayoutPaise: bigint;
}

/** After acceptance: the address too. Client phones are never exposed (Invariant 11). */
export interface AssignmentBookingDetail extends OfferBookingSummary {
  readonly venueAddress: string;
  readonly venueLandmark: string | null;
  readonly specialRequirements: string | null;
}
