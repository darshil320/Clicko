import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { AcceptanceCaptureService } from './acceptance-capture.service';
import { DispatchStartService } from './dispatch-start.service';
import { OffersService } from './offers.service';

/** Dispatch's outbox subscriptions (ADR-0010). Every handler is idempotent. */
@Injectable()
export class DispatchSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(DispatchStartService) private readonly start: DispatchStartService,
    @Inject(AcceptanceCaptureService) private readonly capture: AcceptanceCaptureService,
    @Inject(OffersService) private readonly offers: OffersService,
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
    // ADR-0027 D4: a client blocked a photographer — withdraw that photographer's open offers.
    this.subscribers.subscribe('client_block.added', 'dispatch.withdraw-blocked-offers', (e) =>
      this.offers.withdrawForBlock(
        Uuid.parse(e.payload.user_id),
        Uuid.parse(e.payload.photographer_id),
      ),
    );
  }
}
