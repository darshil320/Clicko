import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxPublisher } from '../infra/outbox/outbox-publisher';
import { type JobProcessor, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';

/** Repeatable every 2 s (infra/queues REPEATABLE_JOBS): drains the transactional outbox. */
@Injectable()
export class OutboxPublishProcessor implements JobProcessor, OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(OutboxPublisher) private readonly publisher: OutboxPublisher,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.OUTBOX_PUBLISH, this);
  }

  async process(): Promise<void> {
    await this.publisher.tick();
  }
}
