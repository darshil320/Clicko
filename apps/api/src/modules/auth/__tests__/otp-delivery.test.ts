import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it } from 'vitest';
import type { JobData } from '../../../infra/queues/job-registry';
import type { JobScheduler } from '../../../infra/queues/job-scheduler';
import { JOB, type JobName } from '../../../infra/queues/queue-names';
import { OtpDelivery } from '../otp-delivery';
import type { SmsPort } from '../sms/sms.port';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const PEPPER = 'p'.repeat(32);
const PHONE = '+919876543210';

class Jobs implements JobScheduler {
  queued: Array<{ job: JobName; data: JobData; at: Date; jobId: string }> = [];
  async runAt(job: JobName, data: JobData, at: Date, jobId: string) {
    this.queued = [...this.queued, { job, data, at, jobId }];
  }
}

class Sms implements SmsPort {
  sent: Array<{ phone: string; code: string }> = [];
  fail = false;
  async sendOtp(phone: string, code: string) {
    if (this.fail) throw new Error('gateway down');
    this.sent = [...this.sent, { phone, code }];
  }
}

describe('OtpDelivery (ADR-0012 D8: SMS off the request path)', () => {
  beforeAll(() => Logger.overrideLogger(false));

  const setup = (now = NOW) => {
    const jobs = new Jobs();
    const sms = new Sms();
    let clock = now;
    const delivery = new OtpDelivery(jobs, sms, () => clock, PEPPER);
    return { jobs, sms, delivery, setClock: (d: Date) => (clock = d) };
  };
  const expiresAt = new Date(NOW.getTime() + 5 * 60_000);

  it('queues a sealed job: neither the code nor the phone is readable in Redis', async () => {
    const { jobs, delivery } = setup();
    await delivery.enqueue({
      challengeId: 'ch-1',
      phone: PHONE,
      code: '424242',
      deliver: true,
      expiresAt,
    });
    expect(jobs.queued).toHaveLength(1);
    const [job] = jobs.queued;
    expect(job).toMatchObject({ job: JOB.AUTH_OTP_SMS, at: NOW, jobId: 'otp-sms-ch-1' });
    const raw = JSON.stringify(job?.data);
    expect(raw).not.toContain('424242');
    expect(raw).not.toContain('9876543210');
  });

  it('sends the code when the job runs', async () => {
    const { jobs, sms, delivery } = setup();
    await delivery.enqueue({
      challengeId: 'ch-2',
      phone: PHONE,
      code: '111222',
      deliver: true,
      expiresAt,
    });
    await delivery.deliver(jobs.queued[0]?.data ?? {});
    expect(sms.sent).toEqual([{ phone: PHONE, code: '111222' }]);
  });

  it('a decoy (number we will not reveal) is queued the same way but never sent', async () => {
    const { jobs, sms, delivery } = setup();
    await delivery.enqueue({
      challengeId: 'ch-3',
      phone: PHONE,
      code: '333444',
      deliver: false,
      expiresAt,
    });
    expect(jobs.queued).toHaveLength(1);
    await delivery.deliver(jobs.queued[0]?.data ?? {});
    expect(sms.sent).toEqual([]);
  });

  it('a gateway failure throws so BullMQ retries; an expired code is dropped instead', async () => {
    const { jobs, sms, delivery, setClock } = setup();
    await delivery.enqueue({
      challengeId: 'ch-4',
      phone: PHONE,
      code: '555666',
      deliver: true,
      expiresAt,
    });
    const data = jobs.queued[0]?.data ?? {};
    sms.fail = true;
    await expect(delivery.deliver(data)).rejects.toThrow(/gateway down/);
    setClock(new Date(expiresAt.getTime() + 1));
    await expect(delivery.deliver(data)).resolves.toBeUndefined();
  });

  it('refuses a tampered or foreign payload', async () => {
    const { delivery } = setup();
    await expect(delivery.deliver({ challengeId: 'x', sealed: 'AAAA' })).rejects.toThrow();
    await expect(delivery.deliver({ nope: true })).rejects.toThrow();
  });
});
