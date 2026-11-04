/**
 * RFC 6238 TOTP (HMAC-SHA-1, 30 s, 6 digits): the staff authenticator code, computed from a
 * base32 secret the operator supplies. Same parameters as apps/api modules/admin/auth/totp.ts.
 */
import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32ToBytes(secret: string): Buffer {
  const clean = secret.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('The authenticator secret is not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at: Date = new Date()): string {
  const counter = Math.floor(at.getTime() / 1000 / STEP_SECONDS);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32ToBytes(secret)).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Seconds left in the current 30 s step. */
export function secondsLeftInStep(at: Date = new Date()): number {
  return STEP_SECONDS - (Math.floor(at.getTime() / 1000) % STEP_SECONDS);
}
