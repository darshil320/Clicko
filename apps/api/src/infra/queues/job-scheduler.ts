import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { BullQueues } from './bull-queues';
import type { JobData } from './job-registry';
import { JOB_OPTIONS, type JobName, QUEUE_OF } from './queue-names';

/**
 * Delayed work, by absolute time. `jobId` dedupes: scheduling the same id twice is one job, which
 * makes "ensure this timer exists" safe to repeat. Ids must not contain ':' (BullMQ).
 */
export interface JobScheduler {
  runAt(job: JobName, data: JobData, at: Date, jobId: string): Promise<void>;
}

export const JOB_SCHEDULER = Symbol('JOB_SCHEDULER');

@Injectable()
export class BullJobScheduler implements JobScheduler {
  constructor(
    @Inject(BullQueues) private readonly queues: BullQueues,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async runAt(job: JobName, data: JobData, at: Date, jobId: string): Promise<void> {
    if (jobId.includes(':')) throw new Error(`Job id "${jobId}" must not contain ':'`);
    const delay = Math.max(0, at.getTime() - this.clock().getTime());
    const retry = JOB_OPTIONS[job];
    await this.queues.get(QUEUE_OF[job]).add(job, data, {
      jobId,
      delay,
      ...(retry
        ? { attempts: retry.attempts, backoff: { type: 'exponential', delay: retry.backoffMs } }
        : {}),
    });
  }
}
