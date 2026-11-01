import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { NotificationSender } from '../modules/notifications/pipeline/notification-sender';

/**
 * One recipient's lifecycle message (ADR-0027 D2). A retryable provider failure throws:
 * BullMQ retries with backoff (JOB_OPTIONS), and a channel that already went is never repeated.
 */
@Injectable()
export class NotificationSendProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(NotificationSender) private readonly sender: NotificationSender,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.NOTIFICATION_SEND, {
      process: (data: JobData) => this.sender.process(data),
    });
  }
}
