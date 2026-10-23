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
