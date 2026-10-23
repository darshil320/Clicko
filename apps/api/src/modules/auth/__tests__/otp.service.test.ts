import { HttpException, Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { OTP_POLICY, OtpService } from '../otp.service';
import type { OtpDeliveryQueue, OtpDeliveryRequest } from '../otp-delivery';
import type { OtpChallengeRow, OtpRepository } from '../repositories/otp.repository';

const PHONE = '+919876543210';
const PEPPER = 'p'.repeat(32);

class FakeOtpRepository implements OtpRepository {
  rows: OtpChallengeRow[] = [];

  async countForPhoneSince(phone: string, purpose: string, since: Date) {
    return this.rows.filter(
      (r) => r.phone === phone && r.purpose === purpose && r.createdAt >= since,
    ).length;
  }
  async countForIpSince(ip: string, since: Date) {
    return this.rows.filter((r) => r.ip === ip && r.createdAt >= since).length;
  }
  async latestCreatedAt(phone: string, purpose: string) {
    const mine = this.rows
      .filter((r) => r.phone === phone && r.purpose === purpose)
      .map((r) => r.createdAt.getTime());
    return mine.length ? new Date(Math.max(...mine)) : null;
  }
  async insert(row: OtpChallengeRow) {
    this.rows = [...this.rows, row];
  }
  async supersedeActive(phone: string, purpose: string, now: Date) {
    this.rows = this.rows.map((r) =>
      r.phone === phone && r.purpose === purpose && !r.consumedAt ? { ...r, consumedAt: now } : r,
    );
  }
  locked = 0;
  async withLocks<T>(
    _phone: string,
    _ip: string | null,
    fn: (repo: OtpRepository) => Promise<T>,
  ): Promise<T> {
    this.locked += 1;
    return fn(this);
  }
  async recordAttempt(id: string, phone: string, purpose: string, now: Date) {
    const row = this.rows.find(
      (r) =>
        r.id === id &&
        r.phone === phone &&
        r.purpose === purpose &&
        !r.consumedAt &&
        r.expiresAt > now &&
        r.attempts < r.maxAttempts,
    );
    if (!row) return null;
    this.rows = this.rows.map((r) => (r === row ? { ...r, attempts: r.attempts + 1 } : r));
    return { codeHash: row.codeHash };
  }
  async consume(id: string, now: Date) {
    const row = this.rows.find((r) => r.id === id && !r.consumedAt);
    if (!row) return false;
    this.rows = this.rows.map((r) => (r === row ? { ...r, consumedAt: now } : r));
    return true;
  }
}

/** Records what would be queued; `sent` holds the codes that would reach a phone. */
class CapturingDelivery implements OtpDeliveryQueue {
  queued: OtpDeliveryRequest[] = [];
  get sent() {
    return this.queued.filter((q) => q.deliver).map((q) => ({ phone: q.phone, code: q.code }));
  }
  async enqueue(request: OtpDeliveryRequest) {
    this.queued = [...this.queued, request];
  }
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e.getStatus();
    throw e;
  }
  return 200;
};

describe('OtpService', () => {
  let now: Date;
  let repo: FakeOtpRepository;
  let sms: CapturingDelivery;
  let service: OtpService;

  beforeEach(() => {
    Logger.overrideLogger(false);
    now = new Date('2026-11-02T10:00:00.000Z');
    repo = new FakeOtpRepository();
    sms = new CapturingDelivery();
    service = new OtpService(repo, sms, () => now, PEPPER);
  });

  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  it('sends a six-digit code and stores only its hash', async () => {
    const res = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    expect(sms.sent).toHaveLength(1);
    const code = sms.sent[0]?.code ?? '';
    expect(code).toMatch(/^\d{6}$/);
    const stored = repo.rows[0];
    expect(stored?.codeHash).not.toContain(code);
    expect(stored?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.expiresAt).toBe(new Date(now.getTime() + OTP_POLICY.ttlMs).toISOString());
  });

  it('verifies the right code once, then never again', async () => {
    const { challengeId } = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    const code = sms.sent[0]?.code ?? '';
    await expect(service.verify(challengeId, PHONE, 'LOGIN', code)).resolves.toBeUndefined();
    expect(await statusOf(service.verify(challengeId, PHONE, 'LOGIN', code))).toBe(401);
  });

  it('rejects a wrong code, the right code for another phone, and an expired code', async () => {
    const { challengeId } = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    const code = sms.sent[0]?.code ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await statusOf(service.verify(challengeId, PHONE, 'LOGIN', wrong))).toBe(401);
    expect(await statusOf(service.verify(challengeId, '+919812345678', 'LOGIN', code))).toBe(401);
    advance(OTP_POLICY.ttlMs + 1);
    expect(await statusOf(service.verify(challengeId, PHONE, 'LOGIN', code))).toBe(401);
  });

  it('locks the challenge after the maximum number of attempts, even for the right code', async () => {
    const { challengeId } = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    const code = sms.sent[0]?.code ?? '';
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_POLICY.maxAttempts; i += 1) {
      await statusOf(service.verify(challengeId, PHONE, 'LOGIN', wrong));
    }
    expect(await statusOf(service.verify(challengeId, PHONE, 'LOGIN', code))).toBe(401);
  });

  it('enforces the resend cooldown per phone', async () => {
    await service.request(PHONE, 'LOGIN', '10.0.0.1');
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(429);
    advance(OTP_POLICY.resendCooldownMs);
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(200);
  });

  it('caps requests per phone per hour', async () => {
    for (let i = 0; i < OTP_POLICY.maxPerPhonePerHour; i += 1) {
      await service.request(PHONE, 'LOGIN', `10.0.0.${i}`);
      advance(OTP_POLICY.resendCooldownMs);
    }
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.1.1'))).toBe(429);
    advance(60 * 60 * 1000);
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.1.1'))).toBe(200);
  });

  it('caps requests per IP per hour across phones', async () => {
    for (let i = 0; i < OTP_POLICY.maxPerIpPerHour; i += 1) {
      await service.request(`+9198765432${String(i).padStart(2, '0')}`, 'LOGIN', '10.9.9.9');
    }
    expect(await statusOf(service.request('+919111111111', 'LOGIN', '10.9.9.9'))).toBe(429);
  });

  it('answers 200 without waiting for the SMS gateway: sending is a queued job (ADR-0012 D8)', async () => {
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(200);
    expect(sms.queued).toHaveLength(1);
  });

  it('answers 503 only when the job queue itself is down, and the attempt still counts', async () => {
    const failing = new OtpService(
      repo,
      { enqueue: async () => Promise.reject(new Error('redis down')) },
      () => now,
      PEPPER,
    );
    expect(await statusOf(failing.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(503);
    expect(await statusOf(failing.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(429);
  });

  it('a number we will not reveal gets the same queued job and response, but no code is sent', async () => {
    const res = await service.request(PHONE, 'PRO_LOGIN', '10.0.0.1', false);
    expect(res).toMatchObject({ resendAfterSeconds: OTP_POLICY.resendCooldownMs / 1000 });
    expect(sms.queued).toHaveLength(1);
    expect(sms.sent).toEqual([]);
  });

  it('counts limits per purpose: a client login does not use up the photographer cooldown', async () => {
    await service.request(PHONE, 'LOGIN', '10.0.0.1');
    expect(await statusOf(service.request(PHONE, 'PRO_LOGIN', '10.0.0.1'))).toBe(200);
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.0.0.1'))).toBe(429);
  });

  it('checks limits and inserts under the per-phone lock, so parallel requests cannot race', async () => {
    await service.request(PHONE, 'LOGIN', '10.0.0.1');
    expect(repo.locked).toBe(1);
  });

  it('invalidates the previous code when a new one is requested', async () => {
    const first = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    const firstCode = sms.sent[0]?.code ?? '';
    advance(OTP_POLICY.resendCooldownMs);
    await service.request(PHONE, 'LOGIN', '10.0.0.1');
    expect(await statusOf(service.verify(first.challengeId, PHONE, 'LOGIN', firstCode))).toBe(401);
  });

  it('rejects a code used for a different purpose', async () => {
    const { challengeId } = await service.request(PHONE, 'LOGIN', '10.0.0.1');
    const code = sms.sent[0]?.code ?? '';
    expect(await statusOf(service.verify(challengeId, PHONE, 'PRO_LOGIN' as 'LOGIN', code))).toBe(
      401,
    );
  });

  it('caps requests per phone per day', async () => {
    for (let i = 0; i < OTP_POLICY.maxPerPhonePerDay; i += 1) {
      expect(await statusOf(service.request(PHONE, 'LOGIN', `10.0.${i}.1`))).toBe(200);
      advance(
        i % OTP_POLICY.maxPerPhonePerHour === OTP_POLICY.maxPerPhonePerHour - 1
          ? 60 * 60 * 1000
          : OTP_POLICY.resendCooldownMs,
      );
    }
    expect(await statusOf(service.request(PHONE, 'LOGIN', '10.9.0.1'))).toBe(429);
  });
});
