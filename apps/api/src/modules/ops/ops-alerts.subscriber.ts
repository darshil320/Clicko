import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEventOnce, type EventValue } from '../../infra/outbox/outbox';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';

const asValue = (v: unknown): EventValue =>
  v === undefined ? null : (JSON.parse(JSON.stringify(v)) as EventValue);

/**
 * Ops alerting until notifications land (S11): logs, and records an `ops.alert` domain event
 * (once per source event) that the ops console and S11 notifiers read.
 *  - dispatch.exhausted: nobody accepted — the desk should call round (ADR-0012 D6).
 *  - ops.dead_letter: an outbox event gave up after 50 tries — money events above all.
 *  - payment.needs_review: money moved off the happy path.
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
