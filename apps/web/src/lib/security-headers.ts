/**
 * The marketing site's security headers live in apps/web/vercel.json (audit M2): a static export
 * has no server to set them. These helpers let the build and the tests read them back.
 *
 * script-src allows 'unsafe-inline': Next's static export inlines per-page RSC payload scripts
 * whose hashes change with every content edit, and Vercel reads vercel.json before the build, so
 * a hash list cannot be kept in step. JSON-LD blocks are data, not script, and need no allowance.
 */
import { readFileSync } from 'node:fs';

interface HeaderRule {
  readonly source: string;
  readonly headers: ReadonlyArray<{ readonly key: string; readonly value: string }>;
}

/** The headers vercel.json sends on every path, by name. */
export function siteHeaders(vercelJson: string): ReadonlyMap<string, string> {
  const parsed = JSON.parse(vercelJson) as { headers?: readonly HeaderRule[] };
  const rule = parsed.headers?.find((r) => r.source === '/(.*)');
  return new Map((rule?.headers ?? []).map((h) => [h.key, h.value]));
}

/** The sources of one CSP directive, e.g. `connect-src` → ["'self'", "https://api.clickco.in"]. */
export function cspSources(csp: string, directive: string): readonly string[] {
  for (const part of csp.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === directive) return sources;
  }
  return [];
}

/**
 * A deploy whose waitlist posts to an origin the CSP does not allow would fail in every browser;
 * stop the build instead. Returns the problem, or null.
 */
export function cspApiProblem(vercelJson: string, endpoint: string): string | null {
  const origin = new URL(endpoint).origin;
  const csp = siteHeaders(vercelJson).get('Content-Security-Policy') ?? '';
  return cspSources(csp, 'connect-src').includes(origin)
    ? null
    : `apps/web/vercel.json CSP connect-src must include the API origin ${origin} (NEXT_PUBLIC_API_URL).`;
}

export const readVercelJson = (path: string): string => readFileSync(path, 'utf8');
