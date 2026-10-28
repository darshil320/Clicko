/**
 * The staff panel shows client phone numbers and addresses (ADR-0025 D2), so it gets the portal's
 * protections (ADR-0015 / security review M7, L7): a nonce-based CSP per request (proxy.ts), the
 * usual hardening headers (next.config.ts), and a deploy build that only talks to an https API.
 * No external origin is allowed anywhere: no fonts, scripts, images or analytics from elsewhere.
 */

const LOCAL_API = 'http://localhost:4000';

export interface CspInput {
  readonly nonce: string;
  /** Origin of NEXT_PUBLIC_API_URL: the only other place the browser may send requests to. */
  readonly apiOrigin: string;
  readonly dev: boolean;
}

export function contentSecurityPolicy({ nonce, apiOrigin, dev }: CspInput): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // Radix positions popovers and menus with an inline style attribute, which cannot run code.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

export const STATIC_SECURITY_HEADERS: ReadonlyArray<{
  readonly key: string;
  readonly value: string;
}> = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  // A page that opened the panel keeps no handle to it (security review L7).
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
];

/** The API base URL; a deploy build (CLICKCO_DEPLOY=1) must set an https one. */
export function resolveApiUrl(configured: string | undefined, deploy: boolean): string {
  if (!configured) {
    if (deploy) throw new Error('NEXT_PUBLIC_API_URL must be set for a deploy build');
    return LOCAL_API;
  }
  const url = new URL(configured);
  if (deploy && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_URL must be https for a deploy build');
  }
  return configured.replace(/\/+$/, '');
}
