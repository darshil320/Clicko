import { z } from 'zod';

/**
 * Every variable the API reads, validated once at boot. Services receive the
 * parsed object through DI (ENV token) — never `process.env.X` inline.
 * Keys are added sprint by sprint as features need them; see /.env.example.
 */
const Secret = z.string().min(32, 'must be at least 32 characters');

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
  })
  .refine(
    (e) => e.SMS_ADAPTER !== 'console' || e.NODE_ENV === 'development' || e.NODE_ENV === 'test',
    {
      message: 'console SMS adapter is only allowed in development and test',
      path: ['SMS_ADAPTER'],
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
