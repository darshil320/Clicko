import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { NoShowService } from './no-show.service';

/** Onsite's outbox subscriptions (ADR-0013 D11). Idempotent: arming twice is one job. */
@Injectable()
export class OnsiteSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(NoShowService) private readonly noShow: NoShowService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.assigned', 'onsite.arm-no-show', (e) =>
      this.noShow.arm(e.aggregateId),
    );
  }
}
