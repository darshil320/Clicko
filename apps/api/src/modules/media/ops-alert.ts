import type postgres from 'postgres';
import { appendDomainEventOnce, type EventValue } from '../../infra/outbox/outbox';

export type AlertSeverity = 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface MediaAlert {
  readonly aggregateKind: 'booking' | 'storage';
  readonly aggregateId: string;
  readonly severity: AlertSeverity;
  /** What happened, e.g. `media.integrity_mismatch` (there is no separate source event row). */
  readonly sourceEventType: string;
  /** One alert per key: re-running a job never pages twice for the same finding. */
  readonly dedupeKey: string;
  readonly details: Readonly<Record<string, EventValue>>;
  readonly occurredAt: Date;
}

/** The `ops.alert` event in the same shape OpsAlertsSubscriber writes (S11 notifiers read these). */
export function appendMediaAlert(tx: postgres.TransactionSql, alert: MediaAlert): Promise<boolean> {
  return appendDomainEventOnce(tx, {
    eventType: 'ops.alert',
    aggregateKind: alert.aggregateKind,
    aggregateId: alert.aggregateId,
    occurredAt: alert.occurredAt,
    dedupeKey: alert.dedupeKey,
    payload: {
      severity: alert.severity,
      source_event_id: null,
      source_event_type: alert.sourceEventType,
      details: alert.details,
    },
  });
}
