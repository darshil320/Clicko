import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP on Node crypto (ADR-0025 D2): HMAC-SHA-1, 30-second steps, 6 digits, and one
 * step of drift either side. Pure functions — the replay guard lives with the login store.
 */
export const TOTP_POLICY = {
  periodSeconds: 30,
  digits: 6,
  /** Steps accepted either side of now (clock drift between phone and server). */
  window: 1,
  /** RFC 4226 §4 R6: at least 128 bits; 160 is the recommended HMAC-SHA-1 key length. */
  secretBytes: 20,
  issuer: 'Clickco Admin',
} as const;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding (what authenticator apps expect). */
export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Case-insensitive; padding ignored. Throws on a character outside the alphabet. */
export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('base32Decode: invalid character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(TOTP_POLICY.secretBytes);
}

/** RFC 4226 HOTP with dynamic truncation. */
export function hotp(secret: Buffer, counter: number, digits: number = TOTP_POLICY.digits): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

export function stepAt(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_POLICY.periodSeconds);
}

export function totpAt(secret: Buffer, at: Date, digits: number = TOTP_POLICY.digits): string {
  return hotp(secret, stepAt(at), digits);
}

/**
 * The time step the code belongs to (now ± window), or null. Every candidate is compared in
 * constant time; the caller must still refuse a step already used (replay guard).
 */
export function verifyTotp(secret: Buffer, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const current = stepAt(now);
  let matched: number | null = null;
  for (let step = current - TOTP_POLICY.window; step <= current + TOTP_POLICY.window; step++) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, given) && matched === null) matched = step;
  }
  return matched;
}

/** Key URI for authenticator apps (Google's otpauth format). */
export function otpauthUri(secretBase32: string, account: string): string {
  const label = `${encodeURIComponent(TOTP_POLICY.issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_POLICY.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_POLICY.digits),
    period: String(TOTP_POLICY.periodSeconds),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, '%20')}`;
}
