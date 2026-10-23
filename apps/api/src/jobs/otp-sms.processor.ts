import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { OtpDelivery } from '../modules/auth/otp-delivery';

/** Sends a queued OTP SMS (ADR-0012 D8). A gateway failure throws: BullMQ retries with backoff. */
@Injectable()
export class OtpSmsProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(OtpDelivery) private readonly delivery: OtpDelivery,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.AUTH_OTP_SMS, {
      process: (data: JobData) => this.delivery.deliver(data),
    });
  }
}
