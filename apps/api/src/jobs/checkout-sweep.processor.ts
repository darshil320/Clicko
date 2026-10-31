import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { PaymentFlowService } from '../modules/checkout/payment-flow.service';

/**
 * Repeatable `checkout.stale-advance-sweep` (audit L3): cancels ADVANCE_PENDING bookings whose
 * payment window closed, releasing their promo redemption.
 */
@Injectable()
export class CheckoutSweepProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(PaymentFlowService) private readonly flow: PaymentFlowService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.CHECKOUT_STALE_SWEEP, {
      process: async () => {
        await this.flow.cancelStaleAdvances();
      },
    });
  }
}
