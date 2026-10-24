import { SlaKind } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { ReleaseService } from './release.service';
import { RetentionService } from './retention.service';

/** Delivery's outbox subscriptions (ADR-0016 D2, D5, D8, D10). All idempotent. */
@Injectable()
export class DeliverySubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(ReleaseService) private readonly release: ReleaseService,
    @Inject(RetentionService) private readonly retention: RetentionService,
  ) {}

  onModuleInit(): void {
    // Nothing left to pay (D2) — or the balance just cleared (D4/D5).
    this.subscribers.subscribe('booking.balance_pending', 'delivery.release', async (e) => {
      await this.release.release(e.aggregateId);
    });
    this.subscribers.subscribe('payment.balance_captured', 'delivery.release', async (e) => {
      await this.release.release(String(e.payload.booking_id));
    });
    this.subscribers.subscribe('sla.retention_due', 'delivery.retention', (e) =>
      this.retention.due(e.aggregateId, SlaKind.parse(e.payload.kind)),
    );
    this.subscribers.subscribe('booking.abandoned', 'delivery.purge-abandoned', (e) =>
      this.retention.abandoned(e.aggregateId),
    );
  }
}
