import type postgres from 'postgres';
import type { PublishedEvent } from './outbox-subscribers';

/** JSON-safe payload values. Money goes in as integer paise numbers (ADR-0007), never bigint. */
export type EventValue =
  | string
  | number
  | boolean
  | null
  | readonly EventValue[]
  | { readonly [key: string]: EventValue };

export interface DomainEvent {
  /** e.g. 'booking.confirmed' (DOMAIN §3). */
  readonly eventType: string;
  readonly aggregateKind: string;
  readonly aggregateId: string;
  readonly payload: Readonly<Record<string, EventValue>>;
  readonly occurredAt: Date;
}

/**
 * Transactional outbox (schema §13). Always pass the transaction that made the state change: the
 * event commits or rolls back with it. Publishing is a separate poller (S5).
 */
export async function appendDomainEvent(
  tx: postgres.TransactionSql,
  event: DomainEvent,
): Promise<void> {
  await tx`
    INSERT INTO domain_events (event_type, aggregate_kind, aggregate_id, payload, occurred_at)
    VALUES (${event.eventType}, ${event.aggregateKind}, ${event.aggregateId},
            ${tx.json(event.payload as postgres.JSONValue)}, ${event.occurredAt})`;
}

/**
 * For at-least-once subscribers: appends the event unless one with the same type, aggregate and
 * `payload.dedupe_key` already exists. Returns false when it was a duplicate.
 */
export async function appendDomainEventOnce(
  tx: postgres.TransactionSql,
  event: DomainEvent & { readonly dedupeKey: string },
): Promise<boolean> {
  await tx`SELECT pg_advisory_xact_lock(hashtext(${`outbox:${event.eventType}:${event.dedupeKey}`}))`;
  const [existing] = await tx`
    SELECT 1 FROM domain_events
    WHERE aggregate_kind = ${event.aggregateKind} AND aggregate_id = ${event.aggregateId}
      AND event_type = ${event.eventType} AND payload->>'dedupe_key' = ${event.dedupeKey}`;
  if (existing) return false;
  const { dedupeKey, ...rest } = event;
  await appendDomainEvent(tx, { ...rest, payload: { ...event.payload, dedupe_key: dedupeKey } });
  return true;
}

/**
 * One event by its id, as subscribers receive it — for queued work that carries only the event id
 * (the notification jobs) and reads the rest when it runs. null when unknown.
 */
export async function readDomainEvent(
  db: postgres.ISql,
  eventId: string,
): Promise<PublishedEvent | null> {
  const [row] = await db<
    {
      event_id: string;
      event_type: string;
      aggregate_kind: string;
      aggregate_id: string;
      payload: Record<string, unknown>;
      occurred_at: Date;
    }[]
  >`
    SELECT event_id, event_type, aggregate_kind, aggregate_id, payload, occurred_at
    FROM domain_events WHERE event_id = ${eventId}`;
  return row
    ? {
        eventId: row.event_id,
        eventType: row.event_type,
        aggregateKind: row.aggregate_kind,
        aggregateId: row.aggregate_id,
        payload: row.payload,
        occurredAt: row.occurred_at,
      }
    : null;
}
