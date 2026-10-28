import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-next';

const ORIGIN = 'https://admin.clickco.in';

describe('safeNext (security review M1)', () => {
  it('follows a desk path on this panel, without its query string', () => {
    expect(safeNext('/bookings', ORIGIN)).toBe('/bookings');
    expect(safeNext('/bookings?q=9812345678', ORIGIN)).toBe('/bookings');
    expect(safeNext('/bookings/7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f', ORIGIN)).toBe(
      '/bookings/7d9f3c1a-2b4e-4c8d-9f10-1a2b3c4d5e6f',
    );
  });

  it('refuses every way out to another site', () => {
    for (const next of [
      '//evil.example',
      '/\\evil.example',
      '/%5Cevil.example',
      '/\t/evil.example',
      '/%09/evil.example',
      '/%2F/evil.example',
      'https://evil.example/bookings',
      'javascript:alert(1)',
    ]) {
      expect(safeNext(next, ORIGIN), next).toBeNull();
    }
  });

  it('refuses sign-in itself, unknown paths, malformed encoding and nothing at all', () => {
    expect(safeNext('/sign-in', ORIGIN)).toBeNull();
    expect(safeNext('/no-such-desk', ORIGIN)).toBeNull();
    expect(safeNext('/%E0%A4%A', ORIGIN)).toBeNull();
    expect(safeNext(null, ORIGIN)).toBeNull();
    expect(safeNext('', ORIGIN)).toBeNull();
  });
});
