import { z } from 'zod';

/**
 * Every variable the API reads, validated once at boot. Services receive the
 * parsed object through DI (ENV token) — never `process.env.X` inline.
 * Keys are added sprint by sprint as features need them; see /.env.example.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
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
