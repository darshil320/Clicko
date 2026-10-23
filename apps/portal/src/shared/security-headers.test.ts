import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, resolveApiUrl, STATIC_SECURITY_HEADERS } from './security-headers';

describe('portal security headers (security review M7)', () => {
  const csp = contentSecurityPolicy({
    nonce: 'abc',
    apiOrigin: 'https://api.clickco.in',
    dev: false,
  });

  it('only runs scripts carrying the per-request nonce', () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('talks to the API origin only, and cannot be framed', () => {
    expect(csp).toContain("connect-src 'self' https://api.clickco.in");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('allows eval in development only (React debugging)', () => {
    const dev = contentSecurityPolicy({
      nonce: 'n',
      apiOrigin: 'http://localhost:4000',
      dev: true,
    });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  it('sends HSTS, nosniff, no referrer and no camera/mic/geolocation', () => {
    const byName = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byName['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    expect(byName['X-Content-Type-Options']).toBe('nosniff');
    expect(byName['Referrer-Policy']).toBe('no-referrer');
    expect(byName['Permissions-Policy']).toContain('camera=()');
  });
});

describe('resolveApiUrl (security review L7)', () => {
  it('falls back to the local API outside a deploy build', () => {
    expect(resolveApiUrl(undefined, false)).toBe('http://localhost:4000');
  });

  it('a deploy build needs an https API URL', () => {
    expect(() => resolveApiUrl(undefined, true)).toThrow(/NEXT_PUBLIC_API_URL/);
    expect(() => resolveApiUrl('http://api.clickco.in', true)).toThrow(/https/);
    expect(resolveApiUrl('https://api.clickco.in/', true)).toBe('https://api.clickco.in');
  });
});
