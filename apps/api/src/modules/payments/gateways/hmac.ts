import { createHmac, timingSafeEqual } from 'node:crypto';

const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function hmacSha256Hex(secret: string, body: Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Constant-time comparison of two hex digests; anything malformed is simply a mismatch. */
export function signatureMatches(received: string | undefined, expectedHex: string): boolean {
  if (typeof received !== 'string' || !SHA256_HEX.test(received)) return false;
  const a = Buffer.from(received.toLowerCase(), 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
