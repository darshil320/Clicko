import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { describe, expect, it } from 'vitest';
import { corsOptionsFor } from './http-app';

const TOKEN = 'A'.repeat(43);
const WEB = 'https://clickco.in';
const PANEL = 'https://admin.clickco.in';

function optionsFor(
  env: { CORS_ORIGINS: string[]; PUBLIC_WEB_URL: string },
  method: string,
  path: string,
): CorsOptions {
  let result: CorsOptions | undefined;
  corsOptionsFor(env)({ method, path }, (error, options) => {
    if (error) throw error;
    result = options;
  });
  if (!result) throw new Error('the delegate did not answer');
  return result;
}

describe('corsOptionsFor (ADR-0027 D6c)', () => {
  const env = { CORS_ORIGINS: [PANEL], PUBLIC_WEB_URL: WEB };

  it('admits the website on GET /d/<token> (and its preflight), for GET only', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      for (const path of [`/d/${TOKEN}`, `/d/${TOKEN}/`]) {
        expect(optionsFor(env, method, path), `${method} ${path}`).toEqual({
          origin: [PANEL, WEB],
          methods: ['GET'],
        });
      }
    }
  });

  it('never admits the website anywhere else: files, other routes, writes, bad tokens', () => {
    const elsewhere = [
      ['GET', `/d/${TOKEN}/files/7d1f0b9e-4a51-4c51-9d0e-2b5f5f0b1a11`],
      ['GET', '/bookings/7d1f0b9e-4a51-4c51-9d0e-2b5f5f0b1a11/delivery'],
      ['GET', '/me'],
      ['POST', `/d/${TOKEN}`],
      ['DELETE', `/d/${TOKEN}`],
      ['GET', '/d/short'],
      ['GET', `/d/${TOKEN}x`],
      ['GET', `/x/d/${TOKEN}`],
    ] as const;
    for (const [method, path] of elsewhere) {
      expect(optionsFor(env, method, path), `${method} ${path}`).toEqual({ origin: [PANEL] });
    }
  });

  it('keeps CORS off everywhere else when CORS_ORIGINS is empty', () => {
    const webOnly = { CORS_ORIGINS: [], PUBLIC_WEB_URL: WEB };
    expect(optionsFor(webOnly, 'GET', '/me')).toEqual({ origin: false });
    expect(optionsFor(webOnly, 'GET', `/d/${TOKEN}`)).toEqual({ origin: [WEB], methods: ['GET'] });
  });

  it('never allows credentials, and lists an origin once', () => {
    const both = { CORS_ORIGINS: [WEB, PANEL], PUBLIC_WEB_URL: `${WEB}/` };
    const listing = optionsFor(both, 'GET', `/d/${TOKEN}`);
    expect(listing.origin).toEqual([WEB, PANEL]);
    expect(listing.credentials).toBeUndefined();
    expect(optionsFor(both, 'GET', '/me').credentials).toBeUndefined();
  });
});
