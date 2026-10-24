import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { SlaService } from '../modules/sla/sla.service';

const Data = z.object({ clockId: Uuid });

/** `sla.clock-due` (one clock) and the repeatable `sla.sweep` (lost jobs) — ADR-0016 D6. */
@Injectable()
export class SlaProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.SLA_CLOCK_DUE, {
      process: async (data: JobData) => {
        await this.sla.fire(Data.parse(data).clockId);
      },
    });
    this.registry.register(JOB.SLA_SWEEP, {
      process: async () => {
        await this.sla.sweep();
      },
    });
  }
}
