import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { CLOCK } from '../common/clock';
import { ENV, type Env, loadEnv } from '../config/env';
import { seedLaunchCities } from '../infra/db/seed';
import { seedLaunchRuleset } from '../infra/db/seeds/launch-ruleset.seed';
import { SMS_PORT, type SmsPort } from '../modules/auth/sms/sms.port';
import { createScratchDb, type ScratchDb } from './scratch-db';

// Loose JSON view for assertions; response shapes are pinned by the contracts tests.
// biome-ignore lint/suspicious/noExplicitAny: test-only access into arbitrary JSON
export type Json = Record<string, any>;

export const E2E_SANDBOX_SECRET = 'e2e-sandbox-webhook-secret-0123456789';

class CapturingSms implements SmsPort {
  readonly last = new Map<string, string>();
  async sendOtp(phone: string, code: string) {
    this.last.set(phone, code);
  }
}

export interface CallOptions {
  readonly body?: unknown;
  readonly token?: string;
  readonly idempotencyKey?: string;
  readonly headers?: Record<string, string>;
  /** Sent verbatim (webhooks): the signature covers these exact bytes. */
  readonly rawBody?: Buffer;
}

export interface E2eApp {
  readonly db: ScratchDb;
  readonly env: Env;
  now(): Date;
  advance(ms: number): void;
  call(
    method: string,
    path: string,
    opts?: CallOptions,
  ): Promise<{ status: number; json: Json; headers: Headers }>;
  /** OTP login through the real endpoints; returns the access token. */
  login(phone: string): Promise<string>;
  close(): Promise<void>;
}

/**
 * The whole API on a scratch database with the launch seed, a controllable clock, captured OTPs,
 * rawBody enabled (as main.ts does) and the sandbox payment gateway.
 */
export async function startE2eApp(opts: {
  readonly now: Date;
  readonly nodeEnv: 'test' | 'development';
}): Promise<E2eApp> {
  Logger.overrideLogger(false);
  const db = await createScratchDb();
  await seedLaunchCities(db.sql);
  await seedLaunchRuleset(db.sql);
  const env = loadEnv({
    NODE_ENV: opts.nodeEnv,
    PORT: '0',
    DATABASE_URL: db.url,
    REDIS_URL: 'redis://localhost:6380',
    JWT_ACCESS_SECRET: 'e2e-access-secret-'.padEnd(40, 'x'),
    OTP_HASH_PEPPER: 'e2e-otp-pepper-'.padEnd(40, 'y'),
    SMS_ADAPTER: 'console',
    PAYMENT_GATEWAY: 'sandbox',
    SANDBOX_WEBHOOK_SECRET: E2E_SANDBOX_SECRET,
  });
  let now = opts.now;
  const sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(SMS_PORT)
    .useValue(sms)
    .overrideProvider(CLOCK)
    .useValue(() => now)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({ rawBody: true });
  await app.listen(0);
  const base = (await app.getUrl()).replace('[::1]', 'localhost');

  const call: E2eApp['call'] = async (method, path, o = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.idempotencyKey ? { 'idempotency-key': o.idempotencyKey } : {}),
        ...(o.headers ?? {}),
      },
      body: o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body)),
    });
    return { status: res.status, json: (await res.json()) as Json, headers: res.headers };
  };

  const login = async (phone: string): Promise<string> => {
    const req = await call('POST', '/auth/otp/request', { body: { phone } });
    const verify = await call('POST', '/auth/otp/verify', {
      body: { challengeId: req.json.data?.challengeId, phone, code: sms.last.get(phone) },
    });
    if (verify.status !== 200) throw new Error(`login failed: ${JSON.stringify(verify.json)}`);
    return verify.json.data.accessToken as string;
  };

  return {
    db,
    env,
    now: () => now,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    call,
    login,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}
