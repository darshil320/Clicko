import { toPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';
import { RefundsService } from './refunds.service';

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/**
 * `payment.refund_settled` (a verified refund webhook, relayed by payments): completes or fails
 * the matching PROCESSING refund. Idempotent: a settled refund, or a stale attempt, is skipped.
 */
@Injectable()
export class RefundsSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('payment.refund_settled', 'refunds.settle', (e) => this.settle(e));
  }

  async settle(e: PublishedEvent): Promise<void> {
    const status = e.payload.status;
    const providerRefundId = str(e.payload.provider_refund_id);
    const amount = e.payload.amount_paise;
    if ((status !== 'PROCESSED' && status !== 'FAILED') || !providerRefundId) return;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) return;
    await this.refunds.settleFromGateway({
      status,
      paymentId: str(e.payload.payment_id),
      providerRefundId,
      amountPaise: toPaiseBigint(amount),
      receipt: str(e.payload.receipt),
    });
  }
}
