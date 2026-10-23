import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';
import { JOB_SCHEDULER, type JobScheduler } from '../../infra/queues/job-scheduler';
import { JOB } from '../../infra/queues/queue-names';

/** BullMQ job id for a booking's export: the same id twice is one job (at-least-once safe). */
export const jpegExportJobId = (bookingId: string): string => `jpeg-export-${bookingId}`;

/**
 * booking.processing → the RAW → JPEG export job (ADR-0014 D4). Enqueue failures throw, so the
 * outbox retries the event; the job id makes a repeat delivery a no-op.
 */
@Injectable()
export class MediaSubscribers implements OnModuleInit {
  constructor(
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(JOB_SCHEDULER) private readonly scheduler: JobScheduler,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.subscribers.subscribe('booking.processing', 'media.jpeg-export', (e) =>
      this.onProcessing(e),
    );
  }

  async onProcessing(event: PublishedEvent): Promise<void> {
    await this.scheduler.runAt(
      JOB.MEDIA_JPEG_EXPORT,
      { bookingId: event.aggregateId },
      this.clock(),
      jpegExportJobId(event.aggregateId),
    );
  }
}
