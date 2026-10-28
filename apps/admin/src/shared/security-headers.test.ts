import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, resolveApiUrl, STATIC_SECURITY_HEADERS } from './security-headers';

describe('admin security headers (ADR-0025 D6, as the portal — ADR-0015)', () => {
  const csp = contentSecurityPolicy({
    nonce: 'abc',
    apiOrigin: 'https://api.clickco.in',
    dev: false,
  });

  it('only runs scripts and style elements carrying the per-request nonce', () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("style-src-elem 'self' 'nonce-abc'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/style-src-elem[^;]*unsafe-inline/);
  });

  it('talks to the API origin only, loads nothing from elsewhere, and cannot be framed', () => {
    expect(csp).toContain("connect-src 'self' https://api.clickco.in");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("font-src 'self'");
    expect(csp).not.toMatch(/https:\/\/(?!api\.clickco\.in)/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
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

  it('sends HSTS, nosniff, no referrer and no framing', () => {
    const byName = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byName['Strict-Transport-Security']).toMatch(/max-age=\d{8}/);
    expect(byName['X-Content-Type-Options']).toBe('nosniff');
    expect(byName['Referrer-Policy']).toBe('no-referrer');
    expect(byName['X-Frame-Options']).toBe('DENY');
    expect(byName['Permissions-Policy']).toContain('camera=()');
  });
});

describe('resolveApiUrl', () => {
  it('falls back to the local API outside a deploy build', () => {
    expect(resolveApiUrl(undefined, false)).toBe('http://localhost:4000');
  });

  it('a deploy build needs an https API URL', () => {
    expect(() => resolveApiUrl(undefined, true)).toThrow(/NEXT_PUBLIC_API_URL/);
    expect(() => resolveApiUrl('http://api.clickco.in', true)).toThrow(/https/);
    expect(resolveApiUrl('https://api.clickco.in/', true)).toBe('https://api.clickco.in');
  });
});

describe('cross-origin isolation (security review L7)', () => {
  it('keeps openers and other origins from holding the panel', () => {
    const byKey = new Map(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(byKey.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
  });
});
