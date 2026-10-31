import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './config/env';

/**
 * JSON body cap. A full 3,000-file upload manifest is ~400 kB; Express's 100 kB default refused
 * anything past ~800 files (security review L1). Every route is still throttled.
 */
export const JSON_BODY_LIMIT = '512kb';

/**
 * Security audit L3, on every API response (set by hand — no helmet dependency). The API serves
 * JSON for signed-in people (tokens, bookings, staff secrets): nothing may sit in a shared or
 * browser cache. A handler may still set its own Cache-Control afterwards.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

/** HTTP settings shared by main.ts and the e2e harness, so tests run the server as deployed. */
export function configureHttpApp(app: NestExpressApplication, env: Env): void {
  app.disable('x-powered-by');
  app.use(
    (_req: unknown, res: { setHeader(name: string, value: string): unknown }, next: () => void) => {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
      next();
    },
  );
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  // Exact hop count so req.ip is the client, not the load balancer (OTP per-IP limits depend on it).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  if (env.CORS_ORIGINS.length > 0) app.enableCors({ origin: env.CORS_ORIGINS });
}
