import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cspApiProblem, cspSources, readVercelJson, siteHeaders } from './security-headers';

const vercelJson = readVercelJson(fileURLToPath(new URL('../../vercel.json', import.meta.url)));
const headers = siteHeaders(vercelJson);
const csp = headers.get('Content-Security-Policy') ?? '';

describe('vercel.json security headers (audit M2)', () => {
  it('sends a CSP fit for the static export', () => {
    expect(cspSources(csp, 'default-src')).toEqual(["'self'"]);
    expect(cspSources(csp, 'script-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(cspSources(csp, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(cspSources(csp, 'img-src')).toEqual(["'self'", 'data:']);
    expect(cspSources(csp, 'media-src')).toEqual(["'self'"]);
    expect(cspSources(csp, 'font-src')).toEqual(["'self'"]);
    expect(cspSources(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(cspSources(csp, 'base-uri')).toEqual(["'self'"]);
    expect(cspSources(csp, 'form-action')).toEqual(["'self'"]);
    expect(cspSources(csp, 'object-src')).toEqual(["'none'"]);
    expect(csp).not.toContain('unsafe-eval');
  });

  it('lets the waitlist reach the production API and nothing else', () => {
    expect(cspSources(csp, 'connect-src')).toEqual(["'self'", 'https://api.clickco.in']);
  });

  it('sends the hardening headers', () => {
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('Permissions-Policy')).toContain('camera=()');
    expect(headers.get('Permissions-Policy')).toContain('geolocation=()');
    expect(headers.get('Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('keeps Vercel building with plain `build` (legal drafts must still deploy)', () => {
    const parsed = JSON.parse(vercelJson) as { buildCommand: string };
    expect(parsed.buildCommand).toMatch(/run build$/);
  });
});

describe('cspApiProblem', () => {
  it('accepts an API origin the CSP allows', () => {
    expect(cspApiProblem(vercelJson, 'https://api.clickco.in/waitlist')).toBeNull();
  });

  it('flags an API origin the CSP would block', () => {
    expect(cspApiProblem(vercelJson, 'https://api.other.in/waitlist')).toMatch(/connect-src/);
  });
});
