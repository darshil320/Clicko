import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  newTotpSecret,
  otpauthUri,
  TOTP_POLICY,
  totpAt,
  verifyTotp,
} from '../auth/totp';

/** RFC 6238 Appendix B: SHA-1 seed "12345678901234567890", 8 digits. */
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('RFC 6238 TOTP', () => {
  it.each(RFC_VECTORS)('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(totpAt(RFC_SEED, new Date(seconds * 1000), 8)).toBe(expected);
  });

  it('6-digit codes are the last six digits of the RFC values', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      expect(totpAt(RFC_SEED, new Date(seconds * 1000))).toBe(expected.slice(2));
    }
  });

  it('matches the RFC 4226 HOTP vectors for counters 0..2', () => {
    expect([0, 1, 2].map((c) => hotp(RFC_SEED, c, 6))).toEqual(['755224', '287082', '359152']);
  });

  it('accepts the current step and one step either side, and returns the matched step', () => {
    const now = new Date(1_700_000_015_000);
    const step = Math.floor(now.getTime() / 1000 / TOTP_POLICY.periodSeconds);
    const at = (s: number) => totpAt(RFC_SEED, new Date(s * TOTP_POLICY.periodSeconds * 1000));
    expect(verifyTotp(RFC_SEED, at(step), now)).toBe(step);
    expect(verifyTotp(RFC_SEED, at(step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SEED, at(step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SEED, at(step - 2), now)).toBeNull();
    expect(verifyTotp(RFC_SEED, at(step + 2), now)).toBeNull();
  });

  it('refuses malformed codes without throwing', () => {
    const now = new Date(1_700_000_000_000);
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 12345']) {
      expect(verifyTotp(RFC_SEED, bad, now)).toBeNull();
    }
  });
});

describe('base32 (RFC 4648)', () => {
  it('round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Encode(Buffer.from('f'))).toBe('MY');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw6ytboi======').toString()).toBe('foobar');
    const secret = newTotpSecret();
    expect(secret).toHaveLength(20);
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW1')).toThrow();
  });
});

describe('otpauth URI', () => {
  it('names the issuer and account and carries the parameters', () => {
    const uri = otpauthUri(base32Encode(RFC_SEED), 'ops@clickco.in');
    expect(uri.startsWith('otpauth://totp/Clickco%20Admin:ops%40clickco.in?')).toBe(true);
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe(base32Encode(RFC_SEED));
    expect(params.get('issuer')).toBe('Clickco Admin');
    expect([params.get('algorithm'), params.get('digits'), params.get('period')]).toEqual([
      'SHA1',
      '6',
      '30',
    ]);
  });
});
