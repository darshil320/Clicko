import type { JobData, JobRegistry } from '../infra/queues/job-registry';
import type { JobScheduler } from '../infra/queues/job-scheduler';
import type { JobName } from '../infra/queues/queue-names';

export interface RecordedJob {
  readonly job: JobName;
  readonly data: JobData;
  readonly at: Date;
  readonly jobId: string;
}

/**
 * Test double for the BullMQ scheduler: records delayed jobs instead of enqueuing them, so tests
 * drive timers by running the due ones through the real processors with a controlled clock.
 */
export class RecordingScheduler implements JobScheduler {
  private readonly jobs = new Map<string, RecordedJob>();
  private readonly done = new Set<string>();

  async runAt(job: JobName, data: JobData, at: Date, jobId: string): Promise<void> {
    if (!this.jobs.has(jobId)) this.jobs.set(jobId, { job, data, at, jobId });
  }

  /** Simulates a job lost between commit and enqueue (the sweeper must recover it). */
  drop(jobId: string): void {
    this.done.add(jobId);
  }

  pending(job?: JobName): RecordedJob[] {
    return [...this.jobs.values()].filter(
      (j) => !this.done.has(j.jobId) && (job === undefined || j.job === job),
    );
  }

  /** Runs every recorded job due at `now` through its registered processor, oldest first. */
  async runDue(registry: JobRegistry, now: Date, job?: JobName): Promise<number> {
    const due = this.pending(job)
      .filter((j) => j.at.getTime() <= now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    for (const j of due) {
      this.done.add(j.jobId);
      const processor = registry.processorFor(j.job);
      if (!processor) throw new Error(`No processor for ${j.job}`);
      await processor.process(j.data);
    }
    return due.length;
  }
}
