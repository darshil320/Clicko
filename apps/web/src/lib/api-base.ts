/**
 * Where the site's browser code reaches the Clickco API, decided once at build time (audit M1):
 * the waitlist form posts there and the delivery page (/d/<token>, ADR-0027 D6c) reads from it.
 * next.config.ts also checks that the CSP's connect-src allows this origin on a deploy build.
 */

type BuildEnv = Readonly<Record<string, string | undefined>>;

export const LOCAL_API = 'http://localhost:4000';

/** Built on Vercel (any environment), with CLICKCO_DEPLOY=1, or with `build:production`. */
export function isDeployBuild(env: BuildEnv): boolean {
  return env.VERCEL === '1' || isProductionBuild(env);
}

/** The production site: Vercel production, CLICKCO_DEPLOY=1, or `build:production`. */
export function isProductionBuild(env: BuildEnv): boolean {
  return env.VERCEL_ENV === 'production' || env.CLICKCO_DEPLOY === '1' || env.LEGAL_STRICT === '1';
}

/** The API base URL (no trailing slash), or why the browser must not call one. */
export type ApiBase =
  | { readonly kind: 'live'; readonly base: string }
  | { readonly kind: 'unavailable' };

/** Built from the parsed URL: scheme, host, port and path only, no trailing slash. */
const baseOf = (url: URL): string => `${url.origin}${url.pathname}`.replace(/\/+$/, '');

/**
 * Vercel builds with plain `build`, so this cannot rely on `build:production`:
 * - local builds fall back to the local API;
 * - a deploy build never calls localhost: with no API URL the features that need it are off;
 * - a production build with an API URL that is not https fails, as does `build:production`
 *   (LEGAL_STRICT=1) with none at all.
 * Throws with the problem; the build must stop.
 */
export function resolveApiBase(env: BuildEnv): ApiBase {
  const configured = env.NEXT_PUBLIC_API_URL?.trim();
  if (!configured) {
    if (env.LEGAL_STRICT === '1') {
      throw new Error(
        'NEXT_PUBLIC_API_URL must be set for a production build (waitlist form, delivery page).',
      );
    }
    return isDeployBuild(env) ? { kind: 'unavailable' } : { kind: 'live', base: LOCAL_API };
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`NEXT_PUBLIC_API_URL is not a valid URL: ${configured}`);
  }
  // The listing and download URLs are built by appending paths: a query, fragment or credentials
  // here would garble them or leak into every request.
  if (url.search || url.hash || url.username || url.password) {
    throw new Error('NEXT_PUBLIC_API_URL must not carry a query, fragment or credentials.');
  }
  if (isDeployBuild(env) && url.protocol !== 'https:') {
    if (isProductionBuild(env)) {
      throw new Error('NEXT_PUBLIC_API_URL must be an https:// URL in production.');
    }
    return { kind: 'unavailable' };
  }
  return { kind: 'live', base: baseOf(url) };
}
