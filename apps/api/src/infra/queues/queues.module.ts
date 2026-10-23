import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { ENV, type Env } from '../../config/env';
import { BullQueues } from './bull-queues';
import { JobRegistry } from './job-registry';
import { BullJobScheduler, JOB_SCHEDULER } from './job-scheduler';
import { QueueWorkers } from './queue-workers';
import { closeRedisClient, createRedisClient, REDIS } from './redis';
import { RedisLocks } from './redis-lock';

/** Redis + BullMQ for the whole API. Processors live in src/jobs/ and register into JobRegistry. */
@Global()
@Module({
  providers: [
    { provide: REDIS, inject: [ENV], useFactory: (env: Env) => createRedisClient(env.REDIS_URL) },
    BullQueues,
    JobRegistry,
    { provide: JOB_SCHEDULER, useClass: BullJobScheduler },
    QueueWorkers,
    RedisLocks,
  ],
  exports: [REDIS, JobRegistry, JOB_SCHEDULER, RedisLocks],
})
export class QueuesModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await closeRedisClient(this.redis);
  }
}
