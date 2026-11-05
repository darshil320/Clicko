import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { RefundsService } from '../modules/refunds/refunds.service';

/**
 * Repeatable `refunds.send-sweep` (security review M2): a refund committed PROCESSING but never
 * answered by the gateway (a crash after the commit, a thrown call) is looked up by its receipt,
 * and re-sent only once the safe wait has passed. Never a blind send: no double refund.
 */
@Injectable()
export class RefundSweepProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.REFUND_SEND_SWEEP, {
      process: async () => {
        await this.refunds.sweepUnsent();
      },
    });
  }
}
