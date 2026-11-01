import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import type { PublishedEvent } from '../../../infra/outbox/outbox-subscribers';
import { JOB_SCHEDULER, type JobScheduler } from '../../../infra/queues/job-scheduler';
import { JOB } from '../../../infra/queues/queue-names';
import type { Recipient } from '../notifications.types';
import { TEMPLATES } from '../templates/templates';
import { sendableAt } from './channel-plan';
import { dedupeKey } from './dedupe';
import { mappingsFor } from './event-map';
import { NotificationReaders } from './readers';

/**
 * A queued message: ids only. The variables (a delivery link token among them) and the phone are
 * read when the job runs, so neither sits in Redis.
 */
export const NotificationJob = z.object({
  eventId: z.uuid(),
  templateCode: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/),
  recipientKind: z.enum(['USER', 'PHOTOGRAPHER', 'SUBJECT']),
  recipientId: z.uuid(),
});
export type NotificationJob = z.infer<typeof NotificationJob>;

export const jobFor = (eventId: string, templateCode: string, r: Recipient): NotificationJob => ({
  eventId,
  templateCode,
  recipientKind: r.kind,
  recipientId: r.id,
});

/**
 * The outbox side of the pipeline (ADR-0027 D2): one BullMQ job per recipient of a mapped event,
 * its id the dedupe key — a redelivered event schedules nothing new while the job is queued, and
 * the processor checks notification_sends after that. A non-essential message raised in quiet
 * hours is delayed to 08:00 IST.
 */
@Injectable()
export class NotificationEnqueuer {
  constructor(
    @Inject(NotificationReaders) private readonly readers: NotificationReaders,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** How many jobs were scheduled (or already were). */
  async enqueue(event: PublishedEvent): Promise<number> {
    const now = this.clock();
    const ctx = this.readers.context(now);
    let scheduled = 0;
    for (const mapping of mappingsFor(event.eventType)) {
      const at = sendableAt(TEMPLATES[mapping.template].category, now);
      for (const intent of await mapping.resolve(event, ctx)) {
        await this.scheduler.runAt(
          JOB.NOTIFICATION_SEND,
          jobFor(event.eventId, mapping.template, intent.recipient),
          at,
          dedupeKey(event.eventId, intent.recipient, mapping.template),
        );
        scheduled += 1;
      }
    }
    return scheduled;
  }
}
