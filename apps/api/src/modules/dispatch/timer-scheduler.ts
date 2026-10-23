import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_SCHEDULER, type JobScheduler } from '../../infra/queues/job-scheduler';
import { JOB } from '../../infra/queues/queue-names';
import type { DispatchTimer } from './dispatch.types';

/**
 * Turns the timers a committed dispatch transaction asked for into BullMQ delayed jobs. Job ids
 * include the due time, so a redelivered event re-arming the same timer is one job. A re-arm from
 * a job that fired early gets a unique suffix (ADR-0012 D1).
 */
@Injectable()
export class DispatchTimerScheduler {
  private readonly logger = new Logger(DispatchTimerScheduler.name);

  constructor(@Inject(JOB_SCHEDULER) private readonly jobs: JobScheduler) {}

  async schedule(timers: readonly DispatchTimer[]): Promise<void> {
    for (const t of timers) {
      const suffix = t.rearm ? `-r${randomUUID()}` : '';
      if (t.kind === 'WAVE_EXPIRY') {
        await this.jobs.runAt(
          JOB.DISPATCH_WAVE_EXPIRY,
          { roundId: t.roundId },
          t.at,
          `wave-expiry-${t.roundId}-${t.at.getTime()}${suffix}`,
        );
      } else {
        await this.jobs.runAt(
          JOB.DISPATCH_DEADLINE,
          { bookingId: t.bookingId },
          t.at,
          `deadline-${t.bookingId}-${t.at.getTime()}${suffix}`,
        );
      }
    }
  }

  /**
   * For request paths that have already committed: a lost wave-expiry job is recovered by the
   * dispatch sweeper, so the caller still gets its answer.
   */
  async scheduleOrLog(timers: readonly DispatchTimer[]): Promise<void> {
    try {
      await this.schedule(timers);
    } catch (error) {
      this.logger.error(
        `Could not schedule ${timers.length} dispatch timer(s): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
