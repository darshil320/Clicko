import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { type ConnectionOptions, Queue } from 'bullmq';
import { ENV, type Env } from '../../config/env';
import type { QueueName } from './queue-names';
import { redisOptions } from './redis';

/** Completed jobs are dropped (so a jobId can be scheduled again); failures are kept for ops. */
const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: { count: 1_000 },
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
} as const;

/** One lazily opened BullMQ Queue per name, sharing the namespace prefix. */
@Injectable()
export class BullQueues implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(ENV) private readonly env: Env) {}

  get prefix(): string {
    return this.env.QUEUE_PREFIX;
  }

  connection(): ConnectionOptions {
    return redisOptions(this.env.REDIS_URL);
  }

  get(name: QueueName): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, {
      connection: this.connection(),
      prefix: this.prefix,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    this.queues.set(name, queue);
    return queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
