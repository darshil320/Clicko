import { AssignmentEventId } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { type JobData, type JobProcessor, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { ExtensionsService } from '../modules/onsite/extensions.service';
import { NoShowService } from '../modules/onsite/no-show.service';

const AssignmentJob = z.object({ assignmentId: z.uuid() });
const ExtensionJob = z.object({ eventId: AssignmentEventId });

/** On-site delayed and repeatable jobs (ADR-0013). Payloads are validated: Redis is a trust boundary. */
@Injectable()
export class OnsiteTimersProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(NoShowService) private readonly noShow: NoShowService,
    @Inject(ExtensionsService) private readonly extensions: ExtensionsService,
  ) {}

  onModuleInit(): void {
    const noShow: JobProcessor = {
      process: (data: JobData) => this.noShow.check(AssignmentJob.parse(data).assignmentId, true),
    };
    const expiry: JobProcessor = {
      process: (data: JobData) => this.extensions.expire(ExtensionJob.parse(data).eventId),
    };
    const sweep: JobProcessor = {
      process: async () => {
        await this.noShow.sweep();
      },
    };
    this.registry.register(JOB.ONSITE_NO_SHOW_CHECK, noShow);
    this.registry.register(JOB.ONSITE_EXTENSION_EXPIRY, expiry);
    this.registry.register(JOB.ONSITE_SWEEP, sweep);
  }
}
