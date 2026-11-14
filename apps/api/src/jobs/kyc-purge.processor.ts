import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { KycRetentionService } from '../modules/photographers/kyc-retention.service';

/**
 * Daily (REPEATABLE_JOBS): one batch of KYC documents past their purge_after is deleted through
 * StoragePort and erased (DPDP s.8(7)). A document that fails stays due for the next run.
 */
@Injectable()
export class KycPurgeProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(KycRetentionService) private readonly retention: KycRetentionService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.SUPPLY_KYC_PURGE, {
      process: async () => {
        await this.retention.sweep();
      },
    });
  }
}
