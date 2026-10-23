import {
  appendDomainEvent,
  appendDomainEventOnce,
  type EventValue,
} from '../../infra/outbox/outbox';
import type { Tx } from './onsite.types';

/** On-site outbox events use the booking as aggregate (as dispatch does); ids go in the payload. */
export async function emit(
  tx: Tx,
  eventType: string,
  bookingId: string,
  occurredAt: Date,
  payload: Readonly<Record<string, EventValue>>,
): Promise<void> {
  await appendDomainEvent(tx, {
    eventType,
    aggregateKind: 'booking',
    aggregateId: bookingId,
    occurredAt,
    payload: { booking_id: bookingId, ...payload },
  });
}

/** For at-least-once paths: at most one event per (type, booking, dedupe key). */
export async function emitOnce(
  tx: Tx,
  eventType: string,
  bookingId: string,
  occurredAt: Date,
  dedupeKey: string,
  payload: Readonly<Record<string, EventValue>>,
): Promise<boolean> {
  return appendDomainEventOnce(tx, {
    eventType,
    aggregateKind: 'booking',
    aggregateId: bookingId,
    occurredAt,
    dedupeKey,
    payload: { booking_id: bookingId, ...payload },
  });
}

/** Money effects of on-site events that S8 settles (ADR-0013 D10–D12). */
export type ReviewReason =
  | 'LATE_REPLACEMENT_CREDIT_25'
  | 'ACCESS_DENIED_CHARGE_50'
  | 'UNSAFE_SITE_PARTIAL_CHARGE'
  | 'CLIENT_NON_ATTENDANCE'
  | 'OFFLINE_CHECK_IN_TIME';

/** `booking.needs_review`: the S8 money-review queue (ops is alerted on it). Once per reason. */
export async function needsReview(
  tx: Tx,
  bookingId: string,
  reason: ReviewReason,
  occurredAt: Date,
  details: Readonly<Record<string, EventValue>>,
): Promise<void> {
  await emitOnce(tx, 'booking.needs_review', bookingId, occurredAt, reason, { reason, ...details });
}
