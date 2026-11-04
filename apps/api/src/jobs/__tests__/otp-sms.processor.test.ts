import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { type JobData, JobRegistry } from '../../infra/queues/job-registry';
import { JOB, JOB_OPTIONS } from '../../infra/queues/queue-names';
import type { OtpDelivery } from '../../modules/auth/otp-delivery';
import { SmsSendError } from '../../modules/auth/sms/sms.port';
import { OtpSmsProcessor } from '../otp-sms.processor';

function processorThat(deliver: (data: JobData) => Promise<void>) {
  const registry = new JobRegistry();
  new OtpSmsProcessor(registry, { deliver } as unknown as OtpDelivery).onModuleInit();
  const processor = registry.processorFor(JOB.AUTH_OTP_SMS);
  if (!processor) throw new Error('the OTP SMS processor did not register');
  return processor;
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );

describe('OTP SMS job: BullMQ retries only what a retry can fix', () => {
  it('delivers the job data', async () => {
    let seen: JobData | null = null;
    const processor = processorThat(async (data) => {
      seen = data;
    });
    await processor.process({ challengeId: 'ch-1', sealed: 'x' });
    expect(seen).toEqual({ challengeId: 'ch-1', sealed: 'x' });
  });

  it('a retryable provider failure is rethrown as is (BullMQ backs off and tries again)', async () => {
    const error = new SmsSendError('HTTP_503', true);
    const processor = processorThat(async () => {
      throw error;
    });
    expect(await failure(processor.process({}))).toBe(error);
  });

  it('a final provider failure stops the retries (UnrecoverableError) and keeps only the code', async () => {
    const processor = processorThat(async () => {
      throw new SmsSendError('HTTP_401', false);
    });
    const error = await failure(processor.process({}));
    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).name).toBe('UnrecoverableError');
    expect((error as Error).message).toBe('OTP SMS send failed: HTTP_401');
  });

  it('a send that may have gone out (timeout, 5xx) is tried at most 3 times: budgets count one', () => {
    // The SMS budgets (audit M5) are charged once per request; each retry of an ambiguous failure
    // may bill another SMS to the same number, so the multiplier stays small.
    expect(JOB_OPTIONS[JOB.AUTH_OTP_SMS]?.attempts).toBeLessThanOrEqual(3);
  });

  it('any other error keeps the default retry policy', async () => {
    const error = new Error('Redis hiccup');
    const processor = processorThat(async () => {
      throw error;
    });
    expect(await failure(processor.process({}))).toBe(error);
  });
});
