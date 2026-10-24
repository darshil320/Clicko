import type { BookingStatus } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { SlaService } from './sla.service';

const MILESTONE_EVENTS: ReadonlyArray<readonly [string, BookingStatus]> = [
  ['booking.uploading', 'UPLOADING'],
  ['booking.processing', 'PROCESSING'],
  ['booking.qa', 'QA'],
];

/** Statuses after which no clock is owed (ABANDONED cancels its own in the same transaction). */
const TERMINAL_EVENTS = [
  'booking.data_loss',
  'booking.cancelled_client',
  'booking.cancelled_pro',
  'booking.pro_no_show',
  'booking.access_denied',
];

/** The SLA machine's outbox subscriptions (ADR-0016 D6–D8, D10–D12). All idempotent. */
@Injectable()
export class SlaSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.checked_out', 'sla.arm-production', (e) =>
      this.sla.armProduction(e.aggregateId, { clientAbsent: e.payload.client_absent === true }),
    );
    this.subscribers.subscribe('booking.unsafe_site', 'sla.arm-production', (e) =>
      this.sla.armProduction(e.aggregateId, { clientAbsent: false }),
    );
    for (const [event, status] of MILESTONE_EVENTS) {
      this.subscribers.subscribe(event, 'sla.milestone', (e) =>
        this.sla.reached(e.aggregateId, status, e.occurredAt),
      );
    }
    this.subscribers.subscribe('booking.balance_pending', 'sla.balance-pending', (e) =>
      this.sla.balancePending(e.aggregateId, e.occurredAt),
    );
    this.subscribers.subscribe('booking.delivered', 'sla.delivered', (e) =>
      this.sla.delivered(e.aggregateId, e.occurredAt),
    );
    for (const event of TERMINAL_EVENTS) {
      this.subscribers.subscribe(event, 'sla.terminal', (e) => this.sla.terminal(e.aggregateId));
    }
  }
}
