import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { type JobData, type JobProcessor, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { DispatchTimersService } from '../modules/dispatch/dispatch-timers.service';

const RoundJob = z.object({ roundId: z.uuid() });
const BookingJob = z.object({ bookingId: z.uuid() });

/** Dispatch's delayed and repeatable jobs. Payloads are validated: Redis is a trust boundary. */
@Injectable()
export class DispatchTimersProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(DispatchTimersService) private readonly timers: DispatchTimersService,
  ) {}

  onModuleInit(): void {
    const waveExpiry: JobProcessor = {
      process: (data: JobData) => this.timers.expireRound(RoundJob.parse(data).roundId),
    };
    const deadline: JobProcessor = {
      process: (data: JobData) => this.timers.deadline(BookingJob.parse(data).bookingId),
    };
    const sweep: JobProcessor = {
      process: async () => {
        await this.timers.sweep();
      },
    };
    this.registry.register(JOB.DISPATCH_WAVE_EXPIRY, waveExpiry);
    this.registry.register(JOB.DISPATCH_DEADLINE, deadline);
    this.registry.register(JOB.DISPATCH_SWEEP, sweep);
  }
}
