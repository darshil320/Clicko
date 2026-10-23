import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './config/env';

/**
 * JSON body cap. A full 3,000-file upload manifest is ~400 kB; Express's 100 kB default refused
 * anything past ~800 files (security review L1). Every route is still throttled.
 */
export const JSON_BODY_LIMIT = '512kb';

/** HTTP settings shared by main.ts and the e2e harness, so tests run the server as deployed. */
export function configureHttpApp(app: NestExpressApplication, env: Env): void {
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Exact hop count so req.ip is the client, not the load balancer (OTP per-IP limits depend on it).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.CORS_ORIGINS.length > 0) app.enableCors({ origin: env.CORS_ORIGINS });
}
