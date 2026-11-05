import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { DLT_TEMPLATE_ID, MSG91_FLOW_ID } from '../infra/sms/msg91-flow';
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

/** The local web dev server (apps/web `next dev`): PUBLIC_WEB_URL in development and test. */
export const LOCAL_WEB_URL = 'http://localhost:3000';

/** Scheme, host and port only: no path, query, fragment or credentials. */
const isOrigin = (value: string): boolean => {
  // Zod runs refinements after a failed z.url() too: an unparsable value is simply not an origin.
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return url.pathname === '/' && !url.search && !url.hash && !url.username && !url.password;
};

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(0).max(65535), // 0 = ephemeral (tests)
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Security audit M4: the table OWNER, used only by migrate.ts. When set, DATABASE_URL is the
    // least-privilege runtime role (clickco_app: no UPDATE/DELETE/TRUNCATE on append-only tables).
    MIGRATION_DATABASE_URL: unsetIfEmpty(z.url({ protocol: /^postgres(ql)?$/ }).optional()),
    // Performance audit (ADR-0027 D6): the API's pool. Size it so (instances × DB_POOL_MAX) stays
    // under the server's max_connections. Idle connections close after DB_IDLE_TIMEOUT_S.
    DB_POOL_MAX: unsetIfEmpty(z.coerce.number().int().min(1).max(200).default(20)),
    DB_IDLE_TIMEOUT_S: unsetIfEmpty(z.coerce.number().int().min(0).max(3600).default(30)),
    // A runaway statement is cancelled after this; a job that needs longer raises it inside its
    // own transaction (SET LOCAL statement_timeout). Migrations use their own connection.
    DB_STATEMENT_TIMEOUT_MS: unsetIfEmpty(
      z.coerce.number().int().min(100).max(600_000).default(5_000),
    ),
    // A transaction left open (a request that hung mid-transaction) is ended after this.
    DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: unsetIfEmpty(
      z.coerce.number().int().min(1_000).max(600_000).default(30_000),
    ),
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
    // `console` prints OTPs to the server log — development only. `dlt` sends them through MSG91 on
    // the DLT-registered OTP template (MSG91_OTP_* plus the shared MSG91 credentials below).
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
    // ── Notifications and masked calls (ADR-0027 D1). `console` records what would be sent —
    // development and test only; staging/production refuse it. Real adapters go live once the
    // provider approvals exist (WhatsApp templates, DLT headers/templates, Exotel KYC).
    WHATSAPP_ADAPTER: unsetIfEmpty(z.enum(['console', 'meta']).default('console')),
    // WhatsApp Business Cloud API: the sending number's id and a system-user access token.
    WHATSAPP_PHONE_NUMBER_ID: unsetIfEmpty(
      z
        .string()
        .regex(/^\d{5,20}$/)
        .optional(),
    ),
    WHATSAPP_ACCESS_TOKEN: unsetIfEmpty(z.string().min(20).optional()),
    WHATSAPP_GRAPH_VERSION: unsetIfEmpty(
      z
        .string()
        .regex(/^v\d{1,3}\.\d$/)
        .default('v21.0'),
    ),
    // Lifecycle SMS (DLT). The OTP SMS keeps its own SMS_ADAPTER.
    NOTIFY_SMS_ADAPTER: unsetIfEmpty(z.enum(['console', 'msg91']).default('console')),
    MSG91_AUTH_KEY: unsetIfEmpty(z.string().min(10).optional()),
    // The DLT-registered header (6 letters) and principal entity id.
    MSG91_SENDER_ID: unsetIfEmpty(
      z
        .string()
        .regex(/^[A-Z]{6}$/)
        .optional(),
    ),
    MSG91_DLT_ENTITY_ID: unsetIfEmpty(
      z
        .string()
        .regex(/^\d{10,25}$/)
        .optional(),
    ),
    // JSON: { "<TEMPLATE_CODE>": { "flowId": "…", "dltTemplateId": "…" } } — one per SMS template
    // (checked against the template catalogue at boot).
    MSG91_TEMPLATES: unsetIfEmpty(z.string().min(2).optional()),
    // The OTP SMS (SMS_ADAPTER=dlt) on the same MSG91 account: its flow (template) id and DLT
    // template id. The flow's one variable is ##otp##.
    MSG91_OTP_FLOW_ID: unsetIfEmpty(z.string().regex(MSG91_FLOW_ID).optional()),
    MSG91_OTP_DLT_TEMPLATE_ID: unsetIfEmpty(z.string().regex(DLT_TEMPLATE_ID).optional()),
    // ADR-0030: the account-deletion code has its own DLT template (it must not read as a sign-in
    // code), on the same account. Same shape: one variable, ##otp##.
    MSG91_DELETE_OTP_FLOW_ID: unsetIfEmpty(z.string().regex(MSG91_FLOW_ID).optional()),
    MSG91_DELETE_OTP_DLT_TEMPLATE_ID: unsetIfEmpty(z.string().regex(DLT_TEMPLATE_ID).optional()),
    PUSH_ADAPTER: unsetIfEmpty(z.enum(['console', 'expo']).default('console')),
    // Expo push security: optional unless "enhanced push security" is on for the project.
    EXPO_ACCESS_TOKEN: unsetIfEmpty(z.string().min(20).optional()),
    CALLS_ADAPTER: unsetIfEmpty(z.enum(['console', 'exotel']).default('console')),
    EXOTEL_ACCOUNT_SID: unsetIfEmpty(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{2,64}$/)
        .optional(),
    ),
    EXOTEL_API_KEY: unsetIfEmpty(z.string().min(8).optional()),
    EXOTEL_API_TOKEN: unsetIfEmpty(z.string().min(8).optional()),
    // Singapore cluster (default) or Mumbai (api.in.exotel.com).
    EXOTEL_API_HOST: unsetIfEmpty(
      z.enum(['api.exotel.com', 'api.in.exotel.com']).default('api.exotel.com'),
    ),
    // The ExoPhone both sides see.
    EXOTEL_CALLER_ID: unsetIfEmpty(
      z
        .string()
        .regex(/^\+?\d{8,15}$/)
        .optional(),
    ),
    // Public https base of this API; Exotel posts call status (duration) to
    // <base>/webhooks/exotel/call-status/<EXOTEL_WEBHOOK_SECRET>.
    PUBLIC_API_URL: unsetIfEmpty(z.url({ protocol: /^https?$/ }).optional()),
    // Public origin of the website (apps/web, ADR-0027 D6c). WhatsApp and SMS link to
    // <PUBLIC_WEB_URL>/d/<token>, the page that lists a delivery link's files, and GET /d/:token
    // allows this origin (CORS, http-app.ts). Required with a real messaging adapter and when
    // deployed (https); development and test default to LOCAL_WEB_URL.
    PUBLIC_WEB_URL: unsetIfEmpty(
      z
        .url({ protocol: /^https?$/ })
        .refine(isOrigin, 'must be an origin: no path, query or fragment')
        .optional(),
    ),
    EXOTEL_WEBHOOK_SECRET: unsetIfEmpty(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be 32+ url-safe characters')
        .optional(),
    ),
    // Rotation: the old secret, still accepted until Exotel's StatusCallback points at the new one.
    EXOTEL_WEBHOOK_SECRET_PREVIOUS: unsetIfEmpty(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{32,128}$/, 'must be 32+ url-safe characters')
        .optional(),
    ),

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
  .superRefine((e, ctx) => {
    // ADR-0027 D1: production refuses to boot with a console adapter selected.
    if (!DEPLOYED.includes(e.NODE_ENV)) return;
    const consoles = [
      ['WHATSAPP_ADAPTER', e.WHATSAPP_ADAPTER],
      ['NOTIFY_SMS_ADAPTER', e.NOTIFY_SMS_ADAPTER],
      ['PUSH_ADAPTER', e.PUSH_ADAPTER],
      ['CALLS_ADAPTER', e.CALLS_ADAPTER],
    ] as const;
    for (const [name, value] of consoles) {
      if (value === 'console') {
        ctx.addIssue({
          code: 'custom',
          path: [name],
          message: 'console adapters are only allowed in development and test',
        });
      }
    }
  })
  .refine(
    (e) =>
      e.WHATSAPP_ADAPTER !== 'meta' ||
      Boolean(e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_ACCESS_TOKEN),
    {
      message: 'the WhatsApp Cloud API needs WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN',
      path: ['WHATSAPP_ACCESS_TOKEN'],
    },
  )
  .superRefine((e, ctx) => {
    // ADR-0029 D1: the OTP SMS goes through MSG91. Each missing variable is named on its own.
    if (e.SMS_ADAPTER !== 'dlt') return;
    const needed = {
      MSG91_AUTH_KEY: e.MSG91_AUTH_KEY,
      MSG91_SENDER_ID: e.MSG91_SENDER_ID,
      MSG91_DLT_ENTITY_ID: e.MSG91_DLT_ENTITY_ID,
      MSG91_OTP_FLOW_ID: e.MSG91_OTP_FLOW_ID,
      MSG91_OTP_DLT_TEMPLATE_ID: e.MSG91_OTP_DLT_TEMPLATE_ID,
      MSG91_DELETE_OTP_FLOW_ID: e.MSG91_DELETE_OTP_FLOW_ID,
      MSG91_DELETE_OTP_DLT_TEMPLATE_ID: e.MSG91_DELETE_OTP_DLT_TEMPLATE_ID,
    };
    for (const [name, value] of Object.entries(needed)) {
      if (value) continue;
      ctx.addIssue({
        code: 'custom',
        path: [name],
        message: `SMS_ADAPTER=dlt sends OTPs through MSG91 and needs ${name}`,
      });
    }
  })
  .refine(
    (e) =>
      e.NOTIFY_SMS_ADAPTER !== 'msg91' ||
      Boolean(e.MSG91_AUTH_KEY && e.MSG91_SENDER_ID && e.MSG91_DLT_ENTITY_ID && e.MSG91_TEMPLATES),
    {
      message: 'MSG91 needs its auth key, DLT sender id, DLT entity id and template ids',
      path: ['MSG91_AUTH_KEY'],
    },
  )
  .refine(
    (e) =>
      e.CALLS_ADAPTER !== 'exotel' ||
      Boolean(
        e.EXOTEL_ACCOUNT_SID &&
          e.EXOTEL_API_KEY &&
          e.EXOTEL_API_TOKEN &&
          e.EXOTEL_CALLER_ID &&
          e.EXOTEL_WEBHOOK_SECRET &&
          e.PUBLIC_API_URL,
      ),
    {
      message:
        'Exotel needs its account sid, API key and token, caller id (ExoPhone), webhook secret and PUBLIC_API_URL',
      path: ['EXOTEL_API_KEY'],
    },
  )
  .refine(
    (e) =>
      !DEPLOYED.includes(e.NODE_ENV) ||
      e.PUBLIC_API_URL === undefined ||
      e.PUBLIC_API_URL.startsWith('https://'),
    {
      message: 'staging and production must use an https PUBLIC_API_URL',
      path: ['PUBLIC_API_URL'],
    },
  )
  .refine(
    (e) =>
      (e.WHATSAPP_ADAPTER === 'console' && e.NOTIFY_SMS_ADAPTER === 'console') ||
      e.PUBLIC_WEB_URL !== undefined,
    {
      message: 'WhatsApp and SMS link to <PUBLIC_WEB_URL>/d/<token>: set it with a real adapter',
      path: ['PUBLIC_WEB_URL'],
    },
  )
  .refine(
    (e) => !DEPLOYED.includes(e.NODE_ENV) || e.PUBLIC_WEB_URL?.startsWith('https://') === true,
    {
      message: 'staging and production must set an https PUBLIC_WEB_URL',
      path: ['PUBLIC_WEB_URL'],
    },
  )
  .transform((e) => ({
    ...e,
    // An origin has no trailing slash: links are `${PUBLIC_WEB_URL}/d/<token>`.
    PUBLIC_WEB_URL: new URL(e.PUBLIC_WEB_URL ?? LOCAL_WEB_URL).origin,
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
  'WHATSAPP_ACCESS_TOKEN',
  'MSG91_AUTH_KEY',
  'EXPO_ACCESS_TOKEN',
  'EXOTEL_API_KEY',
  'EXOTEL_API_TOKEN',
  'EXOTEL_WEBHOOK_SECRET',
  'EXOTEL_WEBHOOK_SECRET_PREVIOUS',
] as const;

const WORKER_NO_CHANNELS = {
  WHATSAPP_ADAPTER: 'meta',
  WHATSAPP_PHONE_NUMBER_ID: '10000000000',
  WHATSAPP_ACCESS_TOKEN: randomBytes(32).toString('hex'),
  NOTIFY_SMS_ADAPTER: 'msg91',
  MSG91_AUTH_KEY: randomBytes(16).toString('hex'),
  MSG91_SENDER_ID: 'NOSEND',
  MSG91_DLT_ENTITY_ID: '1000000000000000000',
  MSG91_TEMPLATES: '{}',
  MSG91_OTP_FLOW_ID: 'MediaWorkerSendsNoOtp',
  MSG91_OTP_DLT_TEMPLATE_ID: '1000000000000000000',
  MSG91_DELETE_OTP_FLOW_ID: 'MediaWorkerSendsNoOtp',
  MSG91_DELETE_OTP_DLT_TEMPLATE_ID: '1000000000000000000',
  PUSH_ADAPTER: 'expo',
  CALLS_ADAPTER: 'exotel',
  EXOTEL_ACCOUNT_SID: 'media-worker-has-no-calls',
  EXOTEL_API_KEY: randomBytes(16).toString('hex'),
  EXOTEL_API_TOKEN: randomBytes(16).toString('hex'),
  EXOTEL_CALLER_ID: '0000000000',
  EXOTEL_WEBHOOK_SECRET: randomBytes(32).toString('hex'),
  PUBLIC_API_URL: 'https://media-worker.invalid',
  PUBLIC_WEB_URL: 'https://media-worker.invalid',
} as const;

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
          // The worker never sends an OTP, a notification or a call: real adapters with throwaway
          // values only satisfy the deployed "no console adapter" rule (ADR-0027 D1).
          ...WORKER_NO_CHANNELS,
        }
      : { PAYMENT_GATEWAY: 'sandbox', SANDBOX_WEBHOOK_SECRET: random(48) }),
  });
}
