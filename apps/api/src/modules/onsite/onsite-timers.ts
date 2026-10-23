import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { JOB_SCHEDULER, type JobScheduler } from '../../infra/queues/job-scheduler';
import { JOB } from '../../infra/queues/queue-names';
import type { OnsiteTimer } from './onsite.types';

/**
 * On-site delayed jobs (ADR-0013). Job ids carry the due time, so arming the same timer twice is
 * one job; a re-arm from a job that fired early gets a unique suffix (its own id is still running).
 */
@Injectable()
export class OnsiteTimerScheduler {
  private readonly logger = new Logger(OnsiteTimerScheduler.name);

  constructor(@Inject(JOB_SCHEDULER) private readonly jobs: JobScheduler) {}

  async schedule(timers: readonly OnsiteTimer[]): Promise<void> {
    for (const t of timers) {
      const suffix = t.rearm ? `-r${randomUUID()}` : '';
      if (t.kind === 'NO_SHOW_CHECK') {
        await this.jobs.runAt(
          JOB.ONSITE_NO_SHOW_CHECK,
          { assignmentId: t.assignmentId },
          t.at,
          `no-show-${t.assignmentId}-${t.at.getTime()}${suffix}`,
        );
      } else {
        await this.jobs.runAt(
          JOB.ONSITE_EXTENSION_EXPIRY,
          { eventId: t.eventId },
          t.at,
          `extension-expiry-${t.eventId}-${t.at.getTime()}${suffix}`,
        );
      }
    }
  }

  /** For request paths that already committed: expiry is also checked lazily; the sweep covers no-shows. */
  async scheduleOrLog(timers: readonly OnsiteTimer[]): Promise<void> {
    try {
      await this.schedule(timers);
    } catch (error) {
      this.logger.error(
        `Could not schedule ${timers.length} on-site timer(s): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
