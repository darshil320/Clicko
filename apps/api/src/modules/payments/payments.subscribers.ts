import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';
import { AuthHoldsService } from './auth-holds.service';
import { PaymentsService } from './payments.service';

const reasonOf = (e: PublishedEvent, fallback: string): string =>
  typeof e.payload.reason === 'string' ? e.payload.reason : fallback;

/**
 * Money consequences of a booking ending without a shoot (ADR-0012 D1/D3/D6). Every handler is
 * idempotent: a release checks the hold is still AUTHORIZED; refund flags are once per payment.
 *  - CANCELLED_PRO / PRO_NO_SHOW: Clickco could not serve — release any hold, flag captured money
 *    for the refund flow (S8).
 *  - CANCELLED_CLIENT: release any hold (capture declined on acceptance; captured client cancels
 *    follow the T&C refund ladder in S8).
 */
@Injectable()
export class PaymentsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(AuthHoldsService) private readonly holds: AuthHoldsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.cancelled_pro', 'payments.unserved', (e) =>
      this.unserved(e, 'REFUND_DUE_UNFILLED'),
    );
    this.subscribers.subscribe('booking.pro_no_show', 'payments.unserved', (e) =>
      this.unserved(e, 'REFUND_DUE_NO_SHOW'),
    );
    this.subscribers.subscribe('booking.cancelled_client', 'payments.release-hold', async (e) => {
      await this.holds.release(e.aggregateId, reasonOf(e, 'CANCELLED_CLIENT'));
    });
  }

  async unserved(event: PublishedEvent, refundReason: string): Promise<void> {
    await this.holds.release(event.aggregateId, reasonOf(event, 'CANCELLED_PRO'));
    await this.payments.flagCapturedForRefund(event.aggregateId, refundReason);
  }
}
