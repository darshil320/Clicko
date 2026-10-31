/**
 * Security audit M1: in staging and production a secret must be a real random value — not a
 * README/.env.example placeholder that happens to be 32 characters long.
 */

/** Words that only ever appear in placeholders and development values. */
const PLACEHOLDER_WORDS: readonly string[] = ['local-dev', 'dev-only', 'example', 'changeme'];

/** The development values printed in apps/api/README.md and the local .env. */
const PUBLISHED_VALUES: ReadonlySet<string> = new Set([
  'local-dev-access-secret-at-least-32-chars',
  'local-dev-otp-pepper-at-least-32-chars',
  'local-dev-otp-pepper-at-least-32-chars-x',
]);

/** 32 random bytes as unpadded base64 are 43 characters (hex: 64). */
export const MIN_SECRET_LENGTH = 43;
/**
 * Rough entropy floor. Over 200,000 samples of 32 random bytes the lowest measured were: base64
 * 4.2 bits/char and 22 distinct characters, hex 3.4 bits/char and 12 distinct. Repeated or
 * patterned text falls below these floors; English-like text may not (this is a rough check).
 */
const MIN_BITS_PER_CHAR = 3.0;
const MIN_DISTINCT_CHARS = 10;

function shannonBitsPerChar(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** For secrets a provider issues (any shape): only placeholders and published values are refused. */
export function publishedSecretProblem(value: string): string | null {
  const lower = value.toLowerCase();
  if (PUBLISHED_VALUES.has(value)) return 'is a published development value';
  if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) return 'looks like a placeholder';
  return null;
}

/** For secrets we generate: null when it looks like ≥32 random bytes, else what is wrong. */
export function strongSecretProblem(value: string): string | null {
  const published = publishedSecretProblem(value);
  if (published) return published;
  if (value.length < MIN_SECRET_LENGTH) {
    return `must be at least ${MIN_SECRET_LENGTH} characters (32 random bytes, e.g. openssl rand -base64 32)`;
  }
  if (new Set(value).size < MIN_DISTINCT_CHARS || shannonBitsPerChar(value) < MIN_BITS_PER_CHAR) {
    return 'does not look random (use openssl rand -base64 32)';
  }
  return null;
}
