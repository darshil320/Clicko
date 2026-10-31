import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import { AppModule } from '../app.module';
import { CLOCK } from '../common/clock';
import { ENV, type Env, loadEnv } from '../config/env';
import { DevToolsModule } from '../dev/dev-tools.module';
import { configureHttpApp } from '../http-app';
import { seedLaunchCities } from '../infra/db/seed';
import { seedLaunchRuleset } from '../infra/db/seeds/launch-ruleset.seed';
import { OutboxPublisher, type PublishTickResult } from '../infra/outbox/outbox-publisher';
import { JobRegistry } from '../infra/queues/job-registry';
import { JOB_SCHEDULER, type JobScheduler } from '../infra/queues/job-scheduler';
import { QueueWorkers } from '../infra/queues/queue-workers';
import { SMS_PORT, type SmsPort } from '../modules/auth/sms/sms.port';
import {
  PAYMENT_GATEWAY,
  type PaymentGatewayPort,
} from '../modules/payments/gateways/payment-gateway.port';
import { RecordingScheduler } from './recording-scheduler';
import { createScratchDb, type ScratchDb } from './scratch-db';

// Loose JSON view for assertions; response shapes are pinned by the contracts tests.
// biome-ignore lint/suspicious/noExplicitAny: test-only access into arbitrary JSON
export type Json = Record<string, any>;

export const E2E_SANDBOX_SECRET = 'e2e-sandbox-webhook-secret-0123456789';

/** Local Docker Redis (docker-compose). Each app gets its own key prefix, removed on close. */
export const TEST_REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://:clickco_local_only@localhost:6380';

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
  readonly sms: CapturingSms;
  readonly scheduler: RecordingScheduler;
  /** The listening server's origin, for raw (non-JSON) requests such as file downloads. */
  readonly baseUrl: string;
  now(): Date;
  advance(ms: number): void;
  call(
    method: string,
    path: string,
    opts?: CallOptions,
  ): Promise<{ status: number; json: Json; headers: Headers }>;
  /** OTP login through the real endpoints; returns the access token. */
  login(phone: string): Promise<string>;
  /** PRO_LOGIN through /pro/auth; returns the access token. */
  proLogin(phone: string): Promise<string>;
  get<T>(token: string | symbol | (abstract new (...args: never[]) => T)): T;
  /** One outbox publisher tick (what the repeatable job does every 2 s). */
  publish(): Promise<PublishTickResult>;
  /** Runs the delayed jobs due now through their real processors. */
  runDueJobs(): Promise<number>;
  close(): Promise<void>;
}

async function dropRedisPrefix(prefix: string): Promise<void> {
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      if (keys.length > 0) await redis.del(...keys);
      cursor = next;
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}

/** Stands in for BullMQ workers: tests run jobs themselves through the recording scheduler. */
export const NO_QUEUE_WORKERS = {
  onApplicationBootstrap: () => {},
  onApplicationShutdown: async () => {},
};

/**
 * The whole API on a scratch database with the launch seed, a controllable clock, captured OTPs,
 * rawBody enabled (as main.ts does), the sandbox payment gateway (or `gateway`), no queue workers
 * and a recording job scheduler (tests run due jobs themselves). `development` also mounts the
 * dev-only routes, as AppModule does when NODE_ENV=development.
 */
export async function startE2eApp(opts: {
  readonly now: Date;
  readonly nodeEnv: 'test' | 'development';
  readonly gateway?: PaymentGatewayPort;
  /** Extra environment variables (e.g. TRUST_PROXY_HOPS for the X-Forwarded-For tests). */
  readonly env?: Readonly<Record<string, string>>;
}): Promise<E2eApp> {
  Logger.overrideLogger(false);
  const db = await createScratchDb();
  await seedLaunchCities(db.sql);
  await seedLaunchRuleset(db.sql);
  const prefix = `clickco-test-${randomBytes(4).toString('hex')}`;
  // Each app gets its own storage folder, removed on close (uploads used to pile up in the OS
  // temp dir, and in apps/api/.storage for development-mode apps).
  const storageRoot = await mkdtemp(join(tmpdir(), 'clickco-e2e-storage-'));
  const env = loadEnv({
    NODE_ENV: opts.nodeEnv,
    PORT: '0',
    STORAGE_LOCAL_ROOT: storageRoot,
    DATABASE_URL: db.url,
    REDIS_URL: TEST_REDIS_URL,
    QUEUE_PREFIX: prefix,
    JWT_ACCESS_SECRET: 'e2e-access-secret-'.padEnd(40, 'x'),
    OTP_HASH_PEPPER: 'e2e-otp-pepper-'.padEnd(40, 'y'),
    SMS_ADAPTER: 'console',
    PAYMENT_GATEWAY: 'sandbox',
    SANDBOX_WEBHOOK_SECRET: E2E_SANDBOX_SECRET,
    // The scratch database is local, so development-mode apps may mount the dev tools (audit L5).
    ...(opts.nodeEnv === 'development' ? { DEV_TOOLS: 'on' } : {}),
    ...opts.env,
  });
  let now = opts.now;
  const sms = new CapturingSms();
  const scheduler = new RecordingScheduler();
  const imports = opts.nodeEnv === 'development' ? [AppModule, DevToolsModule] : [AppModule];
  let builder = Test.createTestingModule({ imports })
    .overrideProvider(QueueWorkers)
    .useValue(NO_QUEUE_WORKERS)
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(SMS_PORT)
    .useValue(sms)
    .overrideProvider(CLOCK)
    .useValue(() => now)
    .overrideProvider(JOB_SCHEDULER)
    .useValue(scheduler satisfies JobScheduler);
  if (opts.gateway) builder = builder.overrideProvider(PAYMENT_GATEWAY).useValue(opts.gateway);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
  configureHttpApp(app, env);
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

  const runDueJobs = () => scheduler.runDue(app.get(JobRegistry), now);

  /** OTP SMS are a queued job (ADR-0012 D8): run it so the code reaches the capturing SMS port. */
  const otpLogin = async (prefixPath: string, phone: string): Promise<string> => {
    const req = await call('POST', `${prefixPath}/otp/request`, { body: { phone } });
    await runDueJobs();
    const verify = await call('POST', `${prefixPath}/otp/verify`, {
      body: { challengeId: req.json.data?.challengeId, phone, code: sms.last.get(phone) },
    });
    if (verify.status !== 200) throw new Error(`login failed: ${JSON.stringify(verify.json)}`);
    return verify.json.data.accessToken as string;
  };

  return {
    db,
    env,
    sms,
    scheduler,
    baseUrl: base,
    now: () => now,
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    call,
    login: (phone) => otpLogin('/auth', phone),
    proLogin: (phone) => otpLogin('/pro/auth', phone),
    get: (token) => app.get(token as never),
    publish: () => app.get(OutboxPublisher).tick(),
    runDueJobs,
    close: async () => {
      await app.close();
      await db.drop();
      await dropRedisPrefix(prefix);
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}
