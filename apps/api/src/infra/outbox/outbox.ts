import type postgres from 'postgres';

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
