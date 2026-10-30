import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers } from '../../infra/outbox/outbox-subscribers';
import { PayoutsService } from './payouts.service';

/** A delivered booking owes its photographer a payout (ADR-0026 D3). Idempotent. */
@Injectable()
export class PayoutsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(PayoutsService) private readonly payouts: PayoutsService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.delivered', 'payouts.accrue', async (e) => {
      await this.payouts.accrueForDelivery(e.aggregateId);
    });
  }
}
