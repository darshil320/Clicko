import { describe, expect, it } from 'vitest';
import { resolveApiBase } from './api-base';

const live = (base: string) => ({ kind: 'live', base });
const PROD = { VERCEL: '1', VERCEL_ENV: 'production' };

describe('resolveApiBase (waitlist form and delivery page, audit M1)', () => {
  it('local builds use the local API; deploys without a URL call none', () => {
    expect(resolveApiBase({})).toEqual(live('http://localhost:4000'));
    expect(resolveApiBase(PROD)).toEqual({ kind: 'unavailable' });
    expect(resolveApiBase({ VERCEL: '1', VERCEL_ENV: 'preview' })).toEqual({
      kind: 'unavailable',
    });
  });

  it('builds the base from the parsed URL, without a trailing slash', () => {
    expect(resolveApiBase({ ...PROD, NEXT_PUBLIC_API_URL: 'https://api.clickco.in/' })).toEqual(
      live('https://api.clickco.in'),
    );
    expect(resolveApiBase({ NEXT_PUBLIC_API_URL: ' https://API.clickco.in/v1// ' })).toEqual(
      live('https://api.clickco.in/v1'),
    );
  });

  it('refuses a query, fragment or credentials: paths are appended to it', () => {
    for (const bad of [
      'https://api.clickco.in/?x=1',
      'https://api.clickco.in/#d',
      'https://user:pw@api.clickco.in',
    ]) {
      expect(() => resolveApiBase({ ...PROD, NEXT_PUBLIC_API_URL: bad }), bad).toThrow(
        /query, fragment or credentials/,
      );
    }
  });

  it('a production build refuses http, and LEGAL_STRICT refuses no URL at all', () => {
    expect(() => resolveApiBase({ ...PROD, NEXT_PUBLIC_API_URL: 'http://api.clickco.in' })).toThrow(
      /https/,
    );
    expect(() => resolveApiBase({ LEGAL_STRICT: '1' })).toThrow(/must be set/);
  });
});
