import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CLOCK, type Clock } from '../../common/clock';
import type { JobData } from '../../infra/queues/job-registry';
import { JOB_SCHEDULER, type JobScheduler } from '../../infra/queues/job-scheduler';
import { JOB } from '../../infra/queues/queue-names';
import { OTP_PEPPER } from './otp-tokens';
import { SMS_PORT, type SmsPort } from './sms/sms.port';

export interface OtpDeliveryRequest {
  readonly challengeId: string;
  readonly phone: string;
  readonly code: string;
  /** false = a decoy: queued exactly like a real send so timing and Redis contents match. */
  readonly deliver: boolean;
  readonly expiresAt: Date;
}

/** What OtpService needs: queue the SMS, never wait for the gateway. */
export interface OtpDeliveryQueue {
  enqueue(request: OtpDeliveryRequest): Promise<void>;
}

const Sealed = z.object({ challengeId: z.string().min(1).max(64), sealed: z.string().min(1) });
const Opened = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/),
  deliver: z.boolean(),
  expiresAt: z.iso.datetime(),
});

/**
 * ADR-0012 D8: OTP SMS go through a BullMQ job (retried with backoff), so the request returns at
 * once and its timing never says whether — or how fast — an SMS went out. Job data is sealed with
 * AES-256-GCM under a key derived from OTP_HASH_PEPPER: Redis never holds a readable code or phone.
 */
@Injectable()
export class OtpDelivery implements OtpDeliveryQueue {
  private readonly logger = new Logger(OtpDelivery.name);
  private readonly key: Buffer;

  constructor(
    @Inject(JOB_SCHEDULER) private readonly jobs: JobScheduler,
    @Inject(SMS_PORT) private readonly sms: SmsPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OTP_PEPPER) pepper: string,
  ) {
    this.key = createHash('sha256').update(`${pepper}:otp-sms-job:v1`).digest();
  }

  async enqueue(r: OtpDeliveryRequest): Promise<void> {
    const sealed = this.seal(
      JSON.stringify({
        phone: r.phone,
        code: r.code,
        deliver: r.deliver,
        expiresAt: r.expiresAt.toISOString(),
      }),
      r.challengeId,
    );
    const data = { challengeId: r.challengeId, sealed };
    await this.jobs.runAt(JOB.AUTH_OTP_SMS, data, this.clock(), `otp-sms-${r.challengeId}`);
  }

  /** The job: throws on a gateway failure so BullMQ retries; drops decoys and expired codes. */
  async deliver(data: JobData): Promise<void> {
    const job = Sealed.parse(data);
    const opened = Opened.parse(JSON.parse(this.open(job.sealed, job.challengeId)));
    if (!opened.deliver) return;
    if (new Date(opened.expiresAt) <= this.clock()) {
      this.logger.warn(`OTP ${job.challengeId} expired before it could be sent`);
      return;
    }
    await this.sms.sendOtp(opened.phone, opened.code);
  }

  private seal(plain: string, challengeId: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(challengeId));
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
  }

  private open(sealed: string, challengeId: string): string {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 29) throw new Error('Sealed OTP payload is too short');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(challengeId));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
