import type { AssignmentEventKind } from '@clickco/contracts';
import type postgres from 'postgres';
import type { ActorKind } from '../bookings/state-machine';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/** An assignment_events row (append-only, Invariant 5). Amounts are bigint paise. */
export interface AssignmentEventRecord {
  /** bigserial, as a decimal string. */
  readonly id: string;
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly kind: AssignmentEventKind;
  readonly minutes: number | null;
  readonly amountPaise: bigint | null;
  readonly note: string | null;
  readonly actorKind: ActorKind;
  readonly actorId: string | null;
  readonly deviceTs: Date | null;
  readonly occurredAt: Date;
}

export interface NewAssignmentEvent {
  readonly assignmentId: string;
  readonly bookingId: string;
  readonly kind: AssignmentEventKind;
  readonly minutes?: number | null;
  readonly amountPaise?: bigint | null;
  readonly note?: string | null;
  /** EWKT 'SRID=4326;POINT(lng lat)' or null. */
  readonly location?: string | null;
  readonly actorKind: ActorKind;
  readonly actorId: string | null;
  readonly deviceTs?: Date | null;
  readonly occurredAt: Date;
}

/** Delayed work an on-site transaction asks for; scheduled only after it commits. */
export type OnsiteTimer =
  | {
      readonly kind: 'NO_SHOW_CHECK';
      readonly assignmentId: string;
      readonly at: Date;
      /** Re-armed by a job that fired early (needs a unique job id). */
      readonly rearm?: boolean;
    }
  | {
      readonly kind: 'EXTENSION_EXPIRY';
      readonly eventId: string;
      readonly at: Date;
      readonly rearm?: boolean;
    };
