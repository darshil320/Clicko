/**
 * Security review M7/L7: the portal carries photographers' sessions and every upload, so it gets a
 * nonce-based CSP (proxy.ts), the usual hardening headers (next.config.ts), and a deploy build that
 * refuses to talk to anything but an https API.
 */

const LOCAL_API = 'http://localhost:4000';

export interface CspInput {
  readonly nonce: string;
  /** Origin of NEXT_PUBLIC_API_URL: the only place the browser may send requests to. */
  readonly apiOrigin: string;
  readonly dev: boolean;
}

export function contentSecurityPolicy({ nonce, apiOrigin, dev }: CspInput): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    // The progress bars set a width: an inline style attribute, which cannot run code.
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
  // No cross-origin window can hold a handle to the portal, and no other site may embed its
  // responses (audit L4, as the admin panel — ADR-0025).
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
