import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { BullQueues } from './bull-queues';
import { JobRegistry } from './job-registry';
import {
  QUEUE,
  QUEUE_OF,
  type QueueName,
  REPEATABLE_JOBS,
  WORKER_CONCURRENCY,
} from './queue-names';

/**
 * Starts one BullMQ worker per queue and upserts the repeatable jobs, unless QUEUE_WORKERS=off
 * (tests, and API instances that should only enqueue). Every job is routed through JobRegistry.
 */
@Injectable()
export class QueueWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorkers.name);
  private workers: readonly Worker[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BullQueues) private readonly queues: BullQueues,
    @Inject(JobRegistry) private readonly registry: JobRegistry,
  ) {}

  /**
   * Never blocks boot on Redis: workers reconnect on their own, and the repeatable jobs are
   * registered in the background (logged if Redis is unreachable; the next boot retries).
   */
  onApplicationBootstrap(): void {
    if (this.env.QUEUE_WORKERS === 'off') return;
    this.workers = Object.values(QUEUE).map((name) => this.startWorker(name));
    void this.registerRepeatables().catch((error: unknown) =>
      this.logger.error(
        `Could not register repeatable jobs: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  private async registerRepeatables(): Promise<void> {
    for (const r of REPEATABLE_JOBS) {
      await this.queues
        .get(QUEUE_OF[r.job])
        .upsertJobScheduler(r.job, { every: r.everyMs }, { name: r.job, data: {} });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }

  private startWorker(name: QueueName): Worker {
    const worker = new Worker(name, (job) => this.run(job), {
      connection: this.queues.connection(),
      prefix: this.queues.prefix,
      concurrency: WORKER_CONCURRENCY[name],
    });
    worker.on('failed', (job, error) =>
      this.logger.warn(`Job ${job?.name ?? '?'} (${job?.id ?? '?'}) failed: ${error.message}`),
    );
    worker.on('error', (error) => this.logger.error(`Worker ${name}: ${error.message}`));
    return worker;
  }

  private async run(job: Job): Promise<void> {
    const processor = this.registry.processorFor(job.name);
    if (!processor) throw new Error(`No processor is registered for job ${job.name}`);
    await processor.process((job.data ?? {}) as Record<string, unknown>);
  }
}
