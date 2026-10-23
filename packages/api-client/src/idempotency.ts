/** Mirrors the API's accepted Idempotency-Key format (G-34): 8–128 of A–Z a–z 0–9 . _ : - */
export const IDEMPOTENCY_KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;

export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_FORMAT.test(key);
}

interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView>(array: T) => T;
}

const HEX = '0123456789abcdef';

function bytesToUuid(bytes: Uint8Array): string {
  const b = Uint8Array.from(bytes);
  // RFC 4122 v4: version nibble 4, variant 10xx.
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(b, (byte) => `${HEX[byte >> 4]}${HEX[byte & 0x0f]}`).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fallbackBytes(): Uint8Array {
  // Last resort for runtimes without Web Crypto. An idempotency key needs uniqueness, not secrecy.
  return Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
}

/**
 * A fresh key for one logical money-mutating action. Generate it once per user intent and
 * reuse it for every retry of that same action — that is what makes a retry safe.
 */
export function newIdempotencyKey(crypto: CryptoLike | undefined = globalThis.crypto): string {
  if (crypto?.randomUUID) return crypto.randomUUID();
  if (crypto?.getRandomValues) return bytesToUuid(crypto.getRandomValues(new Uint8Array(16)));
  return bytesToUuid(fallbackBytes());
}
