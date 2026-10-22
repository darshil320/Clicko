import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { CLOCK } from './common/clock';
import { seedLaunchCities } from './infra/db/seed';
import { SMS_PORT, type SmsPort } from './modules/auth/sms/sms.port';
import { createScratchDb, type ScratchDb, TEST_DATABASE_URL } from './test-support/scratch-db';

// Loose JSON view for assertions; response shapes are pinned by the contracts tests.
// biome-ignore lint/suspicious/noExplicitAny: test-only access into arbitrary JSON
type Json = Record<string, any>;

class CapturingSms implements SmsPort {
  last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

describe.runIf(TEST_DATABASE_URL)('API end to end (auth + serviceability)', () => {
  let db: ScratchDb;
  let app: INestApplication;
  let base: string;
  const sms = new CapturingSms();
  // Controllable clock: lets a test step past OTP cooldowns without sleeping.
  let now = new Date();
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };

  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Json };
  };

  const login = async (phone: string) => {
    const req = await call('POST', '/auth/otp/request', { phone });
    const verify = await call('POST', '/auth/otp/verify', {
      challengeId: req.json.data.challengeId,
      phone,
      code: sms.last.get(phone),
    });
    return verify;
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    Object.assign(process.env, {
      NODE_ENV: 'test',
      PORT: '0',
      DATABASE_URL: db.url,
      REDIS_URL: 'redis://localhost:6380',
      JWT_ACCESS_SECRET: 'e2e-access-secret-'.padEnd(40, 'x'),
      OTP_HASH_PEPPER: 'e2e-otp-pepper-'.padEnd(40, 'y'),
      SMS_ADAPTER: 'console',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PORT)
      .useValue(sms)
      .overrideProvider(CLOCK)
      .useValue(() => now)
      .compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
    base = base.replace('[::1]', 'localhost');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('logs a new user in by OTP and serves /me with the access token', async () => {
    const res = await login('+919876543210');
    expect(res.status).toBe(200);
    expect(res.json.data.user).toMatchObject({ phone: '+919876543210', isNew: true });
    const me = await call('GET', '/me', undefined, res.json.data.accessToken);
    expect(me.status).toBe(200);
    expect(me.json.data.phone).toBe('+919876543210');
  });

  it('recognises a returning user', async () => {
    advance(31_000); // past the resend cooldown from the first login
    const res = await login('+919876543210');
    expect(res.json.data.user.isNew).toBe(false);
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const res = await login('+919812345678');
    const first = res.json.data.refreshToken;
    const rotated = await call('POST', '/auth/refresh', { refreshToken: first });
    expect(rotated.status).toBe(200);
    expect((await call('POST', '/auth/refresh', { refreshToken: first })).status).toBe(401);
    expect(
      (await call('POST', '/auth/refresh', { refreshToken: rotated.json.data.refreshToken }))
        .status,
    ).toBe(401);
  });

  it('rejects /me without a token, using the standard error envelope', async () => {
    const res = await call('GET', '/me');
    expect(res.status).toBe(401);
    expect(res.json).toEqual({
      success: false,
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Sign in required' },
    });
  });

  it('rejects a wrong code without saying why', async () => {
    const phone = '+919700000001';
    const req = await call('POST', '/auth/otp/request', { phone });
    const wrong = sms.last.get(phone) === '000000' ? '111111' : '000000';
    const res = await call('POST', '/auth/otp/verify', {
      challengeId: req.json.data.challengeId,
      phone,
      code: wrong,
    });
    expect(res.status).toBe(401);
    expect(res.json.error.code).toBe('OTP_INVALID');
  });

  it('rate-limits a second OTP request inside the cooldown', async () => {
    const phone = '+919700000002';
    await call('POST', '/auth/otp/request', { phone });
    const again = await call('POST', '/auth/otp/request', { phone });
    expect(again.status).toBe(429);
    expect(again.json.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('validates input with field-level details', async () => {
    const res = await call('POST', '/auth/otp/request', { phone: '12345' });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe('VALIDATION_FAILED');
    expect(res.json.error.details[0].path).toBe('phone');
  });

  it('reports Surat as bookable and Vadodara as limited', async () => {
    const surat = await call('GET', '/serviceability/395007');
    expect(surat.json.data).toMatchObject({
      bookable: true,
      status: 'LIVE',
      city: { name: 'Surat', tier: 'TIER_1' },
    });
    const vadodara = await call('GET', '/serviceability/390007');
    expect(vadodara.json.data).toMatchObject({ bookable: true, limitedAvailability: true });
  });

  it('puts an unserved pincode on the waitlist and counts it', async () => {
    const before = await call('GET', '/serviceability/600001');
    expect(before.json.data).toMatchObject({ bookable: false, status: 'UNKNOWN', waitingCount: 0 });
    const join = await call('POST', '/waitlist', {
      phone: '+919876543210',
      fullName: 'Ananya Iyer',
      pincode: '600001',
    });
    expect(join.json.data).toEqual({ joined: true, waitingCount: 1 });
    const repeat = await call('POST', '/waitlist', {
      phone: '+919876543210',
      fullName: 'Ananya Iyer',
      pincode: '600001',
    });
    expect(repeat.json.data.waitingCount).toBe(1);
  });

  it('refuses the waitlist for a pincode it already serves', async () => {
    const res = await call('POST', '/waitlist', {
      phone: '+919876543210',
      fullName: 'Ananya Iyer',
      pincode: '395007',
    });
    expect(res.status).toBe(409);
  });

  it('seeding twice changes nothing', async () => {
    expect((await seedLaunchCities(db.sql)).pincodes).toBe(0);
  });
});
