import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DEV_STAFF_TOTP_KEY } from '../modules/admin/auth/secret-box';
import { isLocalDatabaseUrl } from './dev-tools';
import { publishedSecretProblem, strongSecretProblem } from './secret-strength';

/**
 * Every variable the API reads, validated once at boot. Services receive the
 * parsed object through DI (ENV token) — never `process.env.X` inline.
 * Keys are added sprint by sprint as features need them; see /.env.example.
 */
const Secret = z.string().min(32, 'must be at least 32 characters');

const DEPLOYED: readonly string[] = ['staging', 'production'];

/** Audit M1: secrets we generate must look like ≥32 random bytes when deployed. */
const GENERATED_SECRETS = ['JWT_ACCESS_SECRET', 'OTP_HASH_PEPPER'] as const;
/** Audit M1: secrets a provider issues (any shape) must at least not be placeholders. */
const ISSUED_SECRETS = ['RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const;

/** Standard base64 that decodes to exactly 32 bytes (an AES-256 key). */
const Base64Key32 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64')
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must decode to 32 bytes');

/** Compared as bytes: the dev key without its `=` padding is still the dev key. */
const isDevStaffTotpKey = (key: string | undefined): boolean =>
  key !== undefined && Buffer.from(key, 'base64').equals(Buffer.from(DEV_STAFF_TOTP_KEY, 'base64'));

/** The sandbox webhook secret that used to be the built-in default: public, so refused (L4). */
const PUBLISHED_SANDBOX_SECRET = 'clickco-sandbox-webhook-secret-dev-only';

/** A key copied from .env.example as `KEY=` arrives as ''. Treat that as unset. */
const unsetIfEmpty = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(0).max(65535), // 0 = ephemeral (tests)
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Security audit M4: the table OWNER, used only by migrate.ts. When set, DATABASE_URL is the
    // least-privilege runtime role (clickco_app: no UPDATE/DELETE/TRUNCATE on append-only tables).
    MIGRATION_DATABASE_URL: unsetIfEmpty(z.url({ protocol: /^postgres(ql)?$/ }).optional()),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    // Namespaces every BullMQ queue and Redis lock key. Tests use a unique value per run.
    // Required in staging/production (no shared default between environments on one Redis).
    QUEUE_PREFIX: unsetIfEmpty(
      z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lowercase letters, digits and hyphens')
        .optional(),
    ),
    // Audit L5: the /dev/* routes also need this, NODE_ENV=development and a localhost database.
    DEV_TOOLS: unsetIfEmpty(z.enum(['on', 'off']).default('off')),
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
    // Signs sandbox webhooks (audit L4): no public default. Required with the sandbox in
    // development (≥32 chars, never the old published string); a test may leave it unset and the
    // gateway then signs with a random per-process secret.
    SANDBOX_WEBHOOK_SECRET: unsetIfEmpty(
      z
        .string()
        .min(32, 'must be at least 32 characters')
        .refine((v) => v !== PUBLISHED_SANDBOX_SECRET, 'the published default is not allowed')
        .optional(),
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
    // Audit H1: `true` = JPEG export runs only in the separate media worker (src/worker.ts, its own
    // hardened container); the API process neither consumes the media-export queue nor runs
    // darktable. Required for darktable in staging/production.
    MEDIA_WORKER_ISOLATED: unsetIfEmpty(
      z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
    ),
    // AES-256-GCM key for staff TOTP secrets at rest (ADR-0025 D2): 32 bytes, base64. Required
    // when deployed; development and test fall back to a fixed PUBLIC key (secret-box.ts).
    STAFF_TOTP_KEY: unsetIfEmpty(Base64Key32.optional()),
    // Audit M4: AES-256-GCM key for photographer bank account numbers at rest (32 bytes, base64).
    // Required when deployed and never equal to STAFF_TOTP_KEY. Its version byte (2–255) is
    // stored with every sealed number; rotate by moving the old key to BANK_ACCOUNT_KEY_PREVIOUS
    // (`<version>:<base64>`, opens only) and bumping the version. Development and test fall back
    // to a key derived from STAFF_TOTP_KEY (version 1).
    // Audit L2: derives the public token of each /d/<token> delivery link (HMAC-SHA256 of the link
    // id); only its sha256 is stored. Required when deployed (rotating it changes every link);
    // development and test derive one from JWT_ACCESS_SECRET.
    DELIVERY_LINK_KEY: unsetIfEmpty(Secret.optional()),
    BANK_ACCOUNT_KEY: unsetIfEmpty(Base64Key32.optional()),
    BANK_ACCOUNT_KEY_VERSION: unsetIfEmpty(z.coerce.number().int().min(2).max(255).default(2)),
    BANK_ACCOUNT_KEY_PREVIOUS: unsetIfEmpty(
      z
        .string()
        .regex(/^\d{1,3}:[A-Za-z0-9+/]+={0,2}$/, 'must be <version>:<base64 key>')
        .transform((v) => {
          const [version, key] = v.split(':') as [string, string];
          return { version: Number(version), key };
        })
        .refine((p) => p.version >= 2 && p.version <= 255, 'version must be 2–255')
        .refine((p) => Buffer.from(p.key, 'base64').length === 32, 'key must decode to 32 bytes')
        .optional(),
    ),
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
  .refine(
    (e) =>
      e.PAYMENT_GATEWAY !== 'sandbox' ||
      e.NODE_ENV === 'test' ||
      e.SANDBOX_WEBHOOK_SECRET !== undefined,
    {
      message: 'the sandbox gateway needs an explicit SANDBOX_WEBHOOK_SECRET (32+ characters)',
      path: ['SANDBOX_WEBHOOK_SECRET'],
    },
  )
  .superRefine((e, ctx) => {
    if (!DEPLOYED.includes(e.NODE_ENV)) return;
    // Problems name the variable only — a value is never echoed (loadEnv prints paths alone).
    for (const name of GENERATED_SECRETS) {
      const problem = strongSecretProblem(e[name]);
      if (problem) ctx.addIssue({ code: 'custom', path: [name], message: problem });
    }
    for (const name of ISSUED_SECRETS) {
      const value = e[name];
      const problem = value === undefined ? null : publishedSecretProblem(value);
      if (problem) ctx.addIssue({ code: 'custom', path: [name], message: problem });
    }
  })
  .refine(
    (e) =>
      e.DEV_TOOLS === 'off' || (e.NODE_ENV === 'development' && isLocalDatabaseUrl(e.DATABASE_URL)),
    {
      message: 'dev tools are only allowed in development against a localhost database',
      path: ['DEV_TOOLS'],
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
  .refine(
    (e) =>
      e.JPEG_EXPORT_ADAPTER !== 'darktable' ||
      !DEPLOYED.includes(e.NODE_ENV) ||
      e.MEDIA_WORKER_ISOLATED,
    {
      message:
        'darktable parses untrusted RAW files: staging and production run it only in the isolated media worker (MEDIA_WORKER_ISOLATED=true)',
      path: ['MEDIA_WORKER_ISOLATED'],
    },
  )
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.STAFF_TOTP_KEY !== undefined, {
    message: 'staging and production must set STAFF_TOTP_KEY',
    path: ['STAFF_TOTP_KEY'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || !isDevStaffTotpKey(e.STAFF_TOTP_KEY), {
    message: 'the public development key is only allowed in development and test',
    path: ['STAFF_TOTP_KEY'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.DELIVERY_LINK_KEY !== undefined, {
    message: 'staging and production must set DELIVERY_LINK_KEY',
    path: ['DELIVERY_LINK_KEY'],
  })
  .refine((e) => e.DELIVERY_LINK_KEY === undefined || e.DELIVERY_LINK_KEY !== e.JWT_ACCESS_SECRET, {
    message: 'must differ from JWT_ACCESS_SECRET',
    path: ['DELIVERY_LINK_KEY'],
  })
  .refine((e) => !DEPLOYED.includes(e.NODE_ENV) || e.BANK_ACCOUNT_KEY !== undefined, {
    message: 'staging and production must set BANK_ACCOUNT_KEY',
    path: ['BANK_ACCOUNT_KEY'],
  })
  .refine(
    (e) =>
      e.BANK_ACCOUNT_KEY === undefined ||
      !Buffer.from(e.BANK_ACCOUNT_KEY, 'base64').equals(
        Buffer.from(e.STAFF_TOTP_KEY ?? DEV_STAFF_TOTP_KEY, 'base64'),
      ),
    { message: 'must differ from STAFF_TOTP_KEY', path: ['BANK_ACCOUNT_KEY'] },
  )
  .refine(
    (e) =>
      e.BANK_ACCOUNT_KEY_PREVIOUS === undefined ||
      (e.BANK_ACCOUNT_KEY !== undefined &&
        e.BANK_ACCOUNT_KEY_PREVIOUS.version !== e.BANK_ACCOUNT_KEY_VERSION),
    {
      message: 'needs BANK_ACCOUNT_KEY, under a different version',
      path: ['BANK_ACCOUNT_KEY_PREVIOUS'],
    },
  )
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

/**
 * Audit H1: secrets the API holds and the media worker (worker.ts) must never be given. When
 * deployed, the worker refuses to boot if any is present in its environment.
 */
export const WORKER_FORBIDDEN_SECRETS = [
  'JWT_ACCESS_SECRET',
  'OTP_HASH_PEPPER',
  'STAFF_TOTP_KEY',
  'BANK_ACCOUNT_KEY',
  'BANK_ACCOUNT_KEY_PREVIOUS',
  'DELIVERY_LINK_KEY',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'SANDBOX_WEBHOOK_SECRET',
  'MIGRATION_DATABASE_URL',
] as const;

/**
 * The media worker's environment (audit H1): the same validated shape as the API's, but every
 * app secret is a throwaway random value made here — nothing the worker loads uses them, and a
 * leak from the worker reveals none of the API's. Must run with MEDIA_WORKER_ISOLATED=true.
 */
export function loadWorkerEnv(source: Record<string, string | undefined>): Env {
  const deployed = DEPLOYED.includes(source.NODE_ENV ?? '');
  const present = WORKER_FORBIDDEN_SECRETS.filter((n) => (source[n] ?? '') !== '');
  if (deployed && present.length > 0) {
    throw new Error(`The media worker must not be given app secrets: ${present.join(', ')}`);
  }
  if (source.MEDIA_WORKER_ISOLATED !== 'true') {
    throw new Error('The media worker runs only with MEDIA_WORKER_ISOLATED=true');
  }
  const random = (bytes = 32) => randomBytes(bytes).toString('base64');
  return loadEnv({
    ...source,
    JWT_ACCESS_SECRET: random(48),
    OTP_HASH_PEPPER: random(48),
    STAFF_TOTP_KEY: random(),
    BANK_ACCOUNT_KEY: random(),
    BANK_ACCOUNT_KEY_PREVIOUS: undefined,
    DELIVERY_LINK_KEY: random(48),
    SMS_ADAPTER: deployed ? 'dlt' : (source.SMS_ADAPTER ?? 'console'),
    ...(deployed
      ? {
          PAYMENT_GATEWAY: 'razorpay',
          RAZORPAY_KEY_ID: 'media-worker-has-no-gateway',
          RAZORPAY_KEY_SECRET: random(),
          RAZORPAY_WEBHOOK_SECRET: random(),
        }
      : { PAYMENT_GATEWAY: 'sandbox', SANDBOX_WEBHOOK_SECRET: random(48) }),
  });
}
