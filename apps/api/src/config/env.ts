import { z } from 'zod';
import { DEV_STAFF_TOTP_KEY } from '../modules/admin/auth/secret-box';

/**
 * Every variable the API reads, validated once at boot. Services receive the
 * parsed object through DI (ENV token) — never `process.env.X` inline.
 * Keys are added sprint by sprint as features need them; see /.env.example.
 */
const Secret = z.string().min(32, 'must be at least 32 characters');

const DEPLOYED: readonly string[] = ['staging', 'production'];

/** Standard base64 that decodes to exactly 32 bytes (an AES-256 key). */
const Base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64')
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must decode to 32 bytes');

/** Compared as bytes: the dev key without its `=` padding is still the dev key. */
const isDevStaffTotpKey = (key: string | undefined): boolean =>
  key !== undefined && Buffer.from(key, 'base64').equals(Buffer.from(DEV_STAFF_TOTP_KEY, 'base64'));

/** A key copied from .env.example as `KEY=` arrives as ''. Treat that as unset. */
const unsetIfEmpty = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(0).max(65535), // 0 = ephemeral (tests)
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Namespaces every BullMQ queue and Redis lock key. Tests use a unique value per run.
    // Required in staging/production (no shared default between environments on one Redis).
    QUEUE_PREFIX: unsetIfEmpty(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and hyphens')
        .optional(),
    ),
    // `off` = enqueue only, never process — test only (tests drive the job handlers directly).
    QUEUE_WORKERS: unsetIfEmpty(z.enum(['on', 'off']).default('on')),
    JWT_ACCESS_SECRET: Secret,
    OTP_HASH_PEPPER: Secret,
    // `console` prints OTPs to the server log — development only. `dlt` lands with TRAI DLT approval.
    SMS_ADAPTER: z.enum(['console', 'dlt']),
    // Load-balancer hops in front of the API. Never `true`: that would trust a client-sent X-Forwarded-For.
    // Required when deployed: a wrong 0 behind a load balancer gives every client one IP (and one
    // rate-limit bucket).
    TRUST_PROXY_HOPS: unsetIfEmpty(z.coerce.number().int().min(0).max(5).optional()),
    // Browser origins allowed to call the API (comma-separated exact origins). Empty = none.
    CORS_ORIGINS: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url())),
    // `sandbox` fakes orders and signs its own webhooks — development and test only (ADR-0009).
    PAYMENT_GATEWAY: unsetIfEmpty(z.enum(['sandbox', 'razorpay']).default('sandbox')),
    RAZORPAY_KEY_ID: unsetIfEmpty(z.string().min(1).optional()),
    RAZORPAY_KEY_SECRET: unsetIfEmpty(z.string().min(1).optional()),
    RAZORPAY_WEBHOOK_SECRET: unsetIfEmpty(z.string().min(16).optional()),
    // Signs sandbox webhooks. A fixed, public dev string: the sandbox never runs where it matters.
    SANDBOX_WEBHOOK_SECRET: unsetIfEmpty(
      z.string().min(16).default('clickco-sandbox-webhook-secret-dev-only'),
    ),
    // Where media bytes live (ADR-0014). `local` = this machine's disk — development and test only.
    STORAGE_ADAPTER: unsetIfEmpty(z.enum(['local', 'drive']).default('local')),
    // Local adapter root (default ./.storage; tests default to the OS temp dir) and its size cap.
    STORAGE_LOCAL_ROOT: unsetIfEmpty(z.string().min(1).optional()),
    STORAGE_LOCAL_LIMIT_BYTES: unsetIfEmpty(
      z.coerce
        .number()
        .int()
        .positive()
        .default(50 * 1024 ** 3),
    ),
    // Rolling-24h upload ceiling for the local adapter (unset = none). Drive's (750 GB) is built in.
    STORAGE_DAILY_UPLOAD_LIMIT_BYTES: unsetIfEmpty(z.coerce.number().int().positive().optional()),
    // Shared Drive + service account (PLAN B10): read by the Drive adapter once it is implemented.
    GOOGLE_DRIVE_SHARED_DRIVE_ID: unsetIfEmpty(z.string().min(1).optional()),
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: unsetIfEmpty(z.string().min(1).optional()),
    // RAW → JPEG export (v0.2 §3.2). `passthrough` registers placeholders — development and test only.
    JPEG_EXPORT_ADAPTER: unsetIfEmpty(z.enum(['darktable', 'passthrough']).default('passthrough')),
    DARKTABLE_CLI_PATH: unsetIfEmpty(z.string().min(1).default('darktable-cli')),
    // AES-256-GCM key for staff TOTP secrets at rest (ADR-0025 D2): 32 bytes, base64. Required
    // when deployed; development and test fall back to a fixed PUBLIC key (secret-box.ts).
    STAFF_TOTP_KEY: unsetIfEmpty(Base64Key32.optional()),
  })
  .refine(
    (e) => e.SMS_ADAPTER !== 'console' || e.NODE_ENV === 'development' || e.NODE_ENV === 'test',
    {
      message: 'console SMS adapter is only allowed in development and test',
      path: ['SMS_ADAPTER'],
    },
  )
  .refine(
    (e) => e.PAYMENT_GATEWAY !== 'sandbox' || e.NODE_ENV === 'development' || e.NODE_ENV === 'test',
    {
      message: 'the sandbox gateway is only allowed in development and test',
      path: ['PAYMENT_GATEWAY'],
    },
  )
  .refine(
    (e) =>
      e.PAYMENT_GATEWAY !== 'razorpay' ||
      Boolean(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET),
    {
      message: 'razorpay needs its key id, key secret and webhook secret',
      path: ['RAZORPAY_KEY_ID'],
    },
  )
  .refine((e) => e.JWT_ACCESS_SECRET !== e.OTP_HASH_PEPPER, {
    message: 'must differ from OTP_HASH_PEPPER',
    path: ['JWT_ACCESS_SECRET'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.REDIS_URL.startsWith('rediss://'), {
    message: 'staging and production must reach Redis over TLS (rediss://)',
    path: ['REDIS_URL'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.QUEUE_PREFIX !== undefined, {
    message: 'staging and production must set QUEUE_PREFIX explicitly',
    path: ['QUEUE_PREFIX'],
  })
  .refine((e) => e.QUEUE_WORKERS === 'on' || e.NODE_ENV === 'test', {
    message: 'queue workers may only be switched off in test',
    path: ['QUEUE_WORKERS'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.TRUST_PROXY_HOPS !== undefined, {
    message: 'staging and production must set TRUST_PROXY_HOPS explicitly',
    path: ['TRUST_PROXY_HOPS'],
  })
  .refine(
    (e) => !DEPLOYED.includes(e.NODE_ENV) || e.CORS_ORIGINS.every((o) => o.startsWith('https://')),
    { message: 'staging and production allow https origins only', path: ['CORS_ORIGINS'] },
  )
  .refine((e) => e.STORAGE_ADAPTER !== 'local' || !DEPLOYED.includes(e.NODE_ENV), {
    message: 'the local storage adapter is only allowed in development and test',
    path: ['STORAGE_ADAPTER'],
  })
  .refine((e) => e.JPEG_EXPORT_ADAPTER !== 'passthrough' || !DEPLOYED.includes(e.NODE_ENV), {
    message: 'the passthrough JPEG exporter is only allowed in development and test',
    path: ['JPEG_EXPORT_ADAPTER'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.STAFF_TOTP_KEY !== undefined, {
    message: 'staging and production must set STAFF_TOTP_KEY',
    path: ['STAFF_TOTP_KEY'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || !isDevStaffTotpKey(e.STAFF_TOTP_KEY), {
    message: 'the public development key is only allowed in development and test',
    path: ['STAFF_TOTP_KEY'],
  })
  .transform((e) => ({
    ...e,
    QUEUE_PREFIX: e.QUEUE_PREFIX ?? 'clickco',
    TRUST_PROXY_HOPS: e.TRUST_PROXY_HOPS ?? 0,
    STAFF_TOTP_KEY: e.STAFF_TOTP_KEY ?? DEV_STAFF_TOTP_KEY,
  }));
export type Env = z.infer<typeof EnvSchema>;

export const ENV = Symbol('ENV');

/** Throws with variable NAMES only — values may be secrets and are never echoed. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid or missing environment variables: ${names}`);
  }
  return result.data;
}
