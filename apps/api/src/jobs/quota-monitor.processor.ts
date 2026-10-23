import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { QuotaMonitorService } from '../modules/media/quota-monitor.service';

/** Every 15 min (REPEATABLE_JOBS): storage usage sample + 60/75/90 % alerts (ADR-0014 D5). */
@Injectable()
export class QuotaMonitorProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(QuotaMonitorService) private readonly monitor: QuotaMonitorService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.MEDIA_QUOTA_MONITOR, {
      process: async () => {
        await this.monitor.sample();
      },
    });
  }
}
