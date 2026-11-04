import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { type JobData, JobRegistry } from '../infra/queues/job-registry';
import { JOB } from '../infra/queues/queue-names';
import { OtpDelivery } from '../modules/auth/otp-delivery';
import { SmsSendError } from '../modules/auth/sms/sms.port';

/**
 * Sends a queued OTP SMS (ADR-0012 D8). A retryable gateway failure (timeout, network, 429, 5xx)
 * throws as is: BullMQ retries with backoff. A final one (bad key, template, number) becomes an
 * UnrecoverableError: no retry can fix it, and the job is reported as a dead letter at once.
 */
@Injectable()
export class OtpSmsProcessor implements OnModuleInit {
  constructor(
    @Inject(JobRegistry) private readonly registry: JobRegistry,
    @Inject(OtpDelivery) private readonly delivery: OtpDelivery,
  ) {}

  onModuleInit(): void {
    this.registry.register(JOB.AUTH_OTP_SMS, {
      process: (data: JobData) => this.send(data),
    });
  }

  private async send(data: JobData): Promise<void> {
    try {
      await this.delivery.deliver(data);
    } catch (error) {
      if (error instanceof SmsSendError && !error.retryable) {
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
