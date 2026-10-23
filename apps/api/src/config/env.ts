import { z } from 'zod';

/**
 * Every variable the API reads, validated once at boot. Services receive the
 * parsed object through DI (ENV token) — never `process.env.X` inline.
 * Keys are added sprint by sprint as features need them; see /.env.example.
 */
const Secret = z.string().min(32, 'must be at least 32 characters');

/** A key copied from .env.example as `KEY=` arrives as ''. Treat that as unset. */
const unsetIfEmpty = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().min(0).max(65535), // 0 = ephemeral (tests)
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    JWT_ACCESS_SECRET: Secret,
    OTP_HASH_PEPPER: Secret,
    // `console` prints OTPs to the server log — development only. `dlt` lands with TRAI DLT approval.
    SMS_ADAPTER: z.enum(['console', 'dlt']),
    // Load-balancer hops in front of the API. Never `true`: that would trust a client-sent X-Forwarded-For.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
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
  });
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
