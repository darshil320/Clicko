import type postgres from 'postgres';
import type { EventValue } from '../infra/outbox/outbox';

/** JSON-safe state for an audit row's before/after (money as integer paise numbers). */
export type AuditState = Readonly<Record<string, EventValue>>;

export interface TxChange {
  readonly before: AuditState | null;
  readonly after: AuditState | null;
}

/**
 * Runs inside a service's own transaction, after its change, with what changed — so a caller
 * (the admin desks' audit log, ADR-0025 D4) commits or rolls back together with the change.
 */
export type TxHook = (tx: postgres.TransactionSql, change: TxChange) => Promise<void>;
