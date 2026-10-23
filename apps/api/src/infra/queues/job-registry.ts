import { Injectable } from '@nestjs/common';
import type { JobName } from './queue-names';

/** Job payloads are plain JSON; each processor validates its own shape. */
export type JobData = Readonly<Record<string, unknown>>;

export interface JobProcessor {
  process(data: JobData): Promise<void>;
}

/**
 * Job name → processor. Processors in src/jobs/ register themselves at module init; the queue
 * workers route every job through here, so a job nobody handles fails loudly instead of vanishing.
 */
@Injectable()
export class JobRegistry {
  private readonly processors = new Map<string, JobProcessor>();

  register(job: JobName, processor: JobProcessor): void {
    if (this.processors.has(job)) throw new Error(`A processor is already registered for ${job}`);
    this.processors.set(job, processor);
  }

  processorFor(job: string): JobProcessor | undefined {
    return this.processors.get(job);
  }
}
