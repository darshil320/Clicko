import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { AcceptanceCaptureService } from './acceptance-capture.service';
import { DispatchStartService } from './dispatch-start.service';

/** Dispatch's outbox subscriptions (ADR-0010). Every handler is idempotent. */
@Injectable()
export class DispatchSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(DispatchStartService) private readonly start: DispatchStartService,
    @Inject(AcceptanceCaptureService) private readonly capture: AcceptanceCaptureService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.confirmed', 'dispatch.start', (e) =>
      this.start.onConfirmed(e.aggregateId),
    );
    this.subscribers.subscribe('booking.assigned', 'dispatch.capture-on-accept', (e) =>
      this.capture.onAssigned(e.aggregateId),
    );
    for (const type of [
      'booking.cancelled_client',
      'booking.cancelled_pro',
      'booking.pro_no_show',
    ]) {
      this.subscribers.subscribe(type, 'dispatch.close-offers', (e) =>
        this.start.onCancelled(e.aggregateId),
      );
    }
  }
}
