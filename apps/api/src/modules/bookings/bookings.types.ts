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
