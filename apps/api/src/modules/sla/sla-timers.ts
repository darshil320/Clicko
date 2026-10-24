import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_SCHEDULER, type JobScheduler } from '../../infra/queues/job-scheduler';
import { JOB } from '../../infra/queues/queue-names';
import type { SlaTimer } from './sla.types';

/**
 * `sla.clock-due` delayed jobs. The id carries the due time, so arming twice is one job and a
 * re-armed clock (reminders, holds) gets a new one. The sweep re-fires a clock whose job was lost.
 */
@Injectable()
export class SlaTimerScheduler {
  private readonly logger = new Logger(SlaTimerScheduler.name);

  constructor(@Inject(JOB_SCHEDULER) private readonly jobs: JobScheduler) {}

  async schedule(timers: readonly SlaTimer[]): Promise<void> {
    for (const t of timers) {
      await this.jobs.runAt(
        JOB.SLA_CLOCK_DUE,
        { clockId: t.clockId },
        t.at,
        `sla-${t.clockId}-${t.at.getTime()}`,
      );
    }
  }

  /** After a commit: a failure is logged; the sweep fires the clock anyway. */
  async scheduleOrLog(timers: readonly SlaTimer[]): Promise<void> {
    try {
      await this.schedule(timers);
    } catch (error) {
      this.logger.error(
        `Could not schedule ${timers.length} SLA timer(s): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
