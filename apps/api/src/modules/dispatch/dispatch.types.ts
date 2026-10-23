import type { AssignmentStatus, DispatchOutcome } from '@clickco/contracts';
import type postgres from 'postgres';
import type { RoundSummary } from './wave-plan';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export type RoundOutcome = 'FILLED' | 'EXHAUSTED' | 'CANCELLED';

export interface RoundRecord extends RoundSummary {
  readonly id: string;
  readonly bookingId: string;
  readonly radiusKm: number;
  readonly candidateCount: number;
  readonly windowSeconds: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
  readonly outcome: RoundOutcome | null;
}

export interface AttemptRecord {
  readonly id: string;
  readonly roundId: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly rankScore: number | null;
  readonly distanceKm: number | null;
  readonly offeredPayoutPaise: bigint;
  readonly notifiedAt: Date;
  readonly expiresAt: Date;
  readonly respondedAt: Date | null;
  readonly outcome: DispatchOutcome;
  readonly declineReason: string | null;
}

/** A pending offer as the Pro app lists it (dispatch facts only; booking details come separately). */
export interface PendingOffer extends AttemptRecord {
  readonly isBroadcast: boolean;
}

export interface AssignmentRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly status: AssignmentStatus;
  readonly isReplacement: boolean;
  readonly blockedFrom: Date;
  readonly blockedUntil: Date;
  readonly acceptedAt: Date;
  readonly releasedAt: Date | null;
  readonly releaseReason: string | null;
}

/** A ranked candidate about to receive an offer. */
export interface OfferCandidate {
  readonly photographerId: string;
  readonly distanceKm: number;
  readonly rankScore: number;
}

/**
 * Delayed work a dispatch transaction asks for; scheduled only after it commits. `rearm` marks a
 * job re-scheduled by a job that fired early — it gets a unique id (the original id may still be
 * the running job, which BullMQ would treat as a duplicate).
 */
export type DispatchTimer =
  | {
      readonly kind: 'WAVE_EXPIRY';
      readonly roundId: string;
      readonly at: Date;
      readonly rearm?: boolean;
    }
  | {
      readonly kind: 'DEADLINE';
      readonly bookingId: string;
      readonly at: Date;
      readonly rearm?: boolean;
    };

/** Which point a venue location is (ADR-0010 fallback chain; ADR-0013 D3 records it). */
export type VenueBasis = 'VENUE' | 'PINCODE_CENTROID' | 'CITY_CENTRE';

export interface VenuePoint {
  /** Geography text (hex EWKB) — opaque outside dispatch/repositories. */
  readonly point: string;
  readonly basis: VenueBasis;
}

/** An assignment with its G-15 check-in/out facts (financial-grade, written once). */
export interface OnsiteAssignment extends AssignmentRecord {
  readonly replacedAssignmentId: string | null;
  readonly checkInAt: Date | null;
  readonly checkInAccuracyM: number | null;
  readonly checkInDistanceM: number | null;
  readonly checkInOffline: boolean;
  readonly checkInDeviceTs: Date | null;
  readonly checkOutAt: Date | null;
  readonly checkOutAccuracyM: number | null;
  readonly checkOutOffline: boolean;
  readonly checkOutDeviceTs: Date | null;
  readonly declaredFrameCount: number | null;
}

/** One geofenced fix as recorded on the assignment. `location` is EWKT ('SRID=4326;POINT(lng lat)'). */
export interface RecordedFix {
  readonly at: Date;
  readonly location: string;
  readonly accuracyM: number;
  readonly offline: boolean;
  readonly deviceTs: Date | null;
}
