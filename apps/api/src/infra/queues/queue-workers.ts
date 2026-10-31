import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import { BullQueues } from './bull-queues';
import { JobRegistry } from './job-registry';
import { PROCESS_ROLE, type ProcessRole, queuesFor, repeatablesFor } from './process-role';
import { QUEUE_OF, type QueueName, WORKER_CONCURRENCY } from './queue-names';

/**
 * Starts one BullMQ worker per queue and upserts the repeatable jobs, unless QUEUE_WORKERS=off
 * (tests, and API instances that should only enqueue). Every job is routed through JobRegistry.
 * Audit H1: with MEDIA_WORKER_ISOLATED the API skips the media-export queue, which only the
 * separate media worker (worker.ts, PROCESS_ROLE `media-worker`) consumes.
 */
@Injectable()
export class QueueWorkers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(QueueWorkers.name);
  private workers: readonly Worker[] = [];

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(BullQueues) private readonly queues: BullQueues,
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'api',
  ) {}

  /**
   * Never blocks boot on Redis: workers reconnect on their own, and the repeatable jobs are
   * registered in the background (logged if Redis is unreachable; the next boot retries).
   */
  onApplicationBootstrap(): void {
    if (this.env.QUEUE_WORKERS === 'off') return;
    this.workers = queuesFor(this.role, this.env.MEDIA_WORKER_ISOLATED).map((name) =>
      this.startWorker(name),
    );
    void this.registerRepeatables().catch((error: unknown) =>
      this.logger.error(
        `Could not register repeatable jobs: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  }

  private async registerRepeatables(): Promise<void> {
    for (const r of repeatablesFor(this.role, this.env.MEDIA_WORKER_ISOLATED)) {
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
