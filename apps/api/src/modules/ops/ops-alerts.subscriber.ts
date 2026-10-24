import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEventOnce, type EventValue } from '../../infra/outbox/outbox';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';

/** On-site events ops must see (ADR-0013 D16); S11 turns them into calls and messages. */
const ONSITE_ALERTS: ReadonlyArray<readonly [string, 'HIGH' | 'CRITICAL']> = [
  ['booking.no_show_suspected', 'CRITICAL'],
  ['assignment.unsafe_reported', 'CRITICAL'],
  ['assignment.access_denied_reported', 'HIGH'],
  ['assignment.client_absent_reported', 'HIGH'],
  ['assignment.waiting_capped', 'HIGH'],
  ['assignment.geofence_unverified', 'HIGH'],
  ['assignment.offline_check_in_after_no_show', 'HIGH'],
  ['booking.needs_review', 'HIGH'],
  // The SLA machine (ADR-0016 D6, D9).
  ['sla.breached', 'CRITICAL'],
  ['sla.red_alert', 'HIGH'],
  ['sla.milestone_missed', 'HIGH'],
  ['delivery.qa_failed', 'HIGH'],
];

const asValue = (v: unknown): EventValue =>
  v === undefined ? null : (JSON.parse(JSON.stringify(v)) as EventValue);

/**
 * Ops alerting until notifications land (S11): logs, and records an `ops.alert` domain event
 * (once per source event) that the ops console and S11 notifiers read.
 *  - dispatch.exhausted: nobody accepted — the desk should call round (ADR-0012 D6).
 *  - ops.dead_letter: an outbox event gave up after 50 tries — money events above all.
 *  - payment.needs_review: money moved off the happy path.
 *  - on-site: no-show suspected, incidents, client absent, capped waiting, unverified geofence,
 *    a late offline check-in, booking.needs_review (ADR-0013 D16).
 */
@Injectable()
export class OpsAlertsSubscriber implements OnModuleInit {
  private readonly logger = new Logger('OpsAlerts');

  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('dispatch.exhausted', 'ops.alert', (e) => this.alert(e, 'HIGH'));
    this.subscribers.subscribe('ops.dead_letter', 'ops.alert', (e) => this.alert(e, 'CRITICAL'));
    this.subscribers.subscribe('payment.needs_review', 'ops.alert', (e) => this.alert(e, 'HIGH'));
    // On-site operations (ADR-0013 D16).
    for (const [type, severity] of ONSITE_ALERTS) {
      this.subscribers.subscribe(type, 'ops.alert', (e) => this.alert(e, severity));
    }
  }

  async alert(event: PublishedEvent, severity: 'HIGH' | 'CRITICAL'): Promise<void> {
    const log = severity === 'CRITICAL' ? 'error' : 'warn';
    this.logger[log](
      `${severity}: ${event.eventType} on ${event.aggregateKind} ${event.aggregateId}`,
    );
    await this.sql.begin((tx) =>
      appendDomainEventOnce(tx, {
        eventType: 'ops.alert',
        aggregateKind: event.aggregateKind,
        aggregateId: event.aggregateId,
        occurredAt: this.clock(),
        dedupeKey: event.eventId,
        payload: {
          severity,
          source_event_id: event.eventId,
          source_event_type: event.eventType,
          details: asValue(event.payload),
        },
      }),
    );
  }
}
