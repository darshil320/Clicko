import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Env } from './config/env';
import { DELIVERY_CONFIG } from './modules/delivery/delivery.config';

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

interface CorsRequest {
  readonly method?: string;
  readonly path?: string;
}

/** `/d/<token>` or `/d/<token>/`: one delivery link's file listing (never a file itself). */
const isDeliveryListing = (path: string): boolean => {
  const match = /^\/d\/([^/]+)\/?$/.exec(path);
  return match?.[1] !== undefined && DELIVERY_CONFIG.publicToken.test(match[1]);
};

/** A read and its preflight. Never a write, and never with credentials. */
const LISTING_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Which browser origins may read a response (ADR-0027 D6c):
 * - CORS_ORIGINS (the admin panel, the portal, Expo web) on every route, as before;
 * - the website's origin (PUBLIC_WEB_URL) on `GET /d/<token>` only, where the delivery page reads
 *   the file list. Downloads are plain navigations and need no CORS; no other route admits it.
 * No route allows credentials: the API authenticates with a bearer token, never a cookie.
 */
export function corsOptionsFor(
  env: Pick<Env, 'CORS_ORIGINS' | 'PUBLIC_WEB_URL'>,
): CorsOptionsDelegate<CorsRequest> {
  const everywhere: CorsOptions = {
    origin: env.CORS_ORIGINS.length > 0 ? [...env.CORS_ORIGINS] : false,
  };
  const listing: CorsOptions = {
    origin: [...new Set([...env.CORS_ORIGINS, new URL(env.PUBLIC_WEB_URL).origin])],
    methods: ['GET'],
  };
  return (req, callback) => {
    const read = LISTING_METHODS.includes(req.method ?? '');
    callback(null, read && isDeliveryListing(req.path ?? '') ? listing : everywhere);
  };
}

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
  app.enableCors(corsOptionsFor(env));
}
