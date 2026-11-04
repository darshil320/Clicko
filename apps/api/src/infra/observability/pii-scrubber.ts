/**
 * ADR-0029 D3: nothing personal leaves the API in an error report. Every adapter (the console
 * one now, Sentry once approved) sends only what `scrubPii` returns:
 * - a field whose NAME is sensitive (phone, email, tokens, secrets, bank, KYC ids, address,
 *   location, names) is replaced whole;
 * - every string is passed through `scrubText`, which masks phone numbers, emails, UPI ids,
 *   JWTs, bearer tokens, delivery-link tokens, long digit runs (bank accounts, Aadhaar), PAN,
 *   IFSC and long opaque tokens. UUIDs stay: they are how a report is traced to a booking.
 * The input is never changed; the output is plain JSON (no cycles, bounded size).
 */

export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;
const MAX_STRING = 2_000;
/** Text is scrubbed whole up to this, then cut to MAX_STRING: a cut never splits a match. */
const MAX_SCRUB_INPUT = 20_000;
const MAX_ITEMS = 50;
const MAX_KEYS = 60;
const MAX_STACK_LINES = 15;

/** Matched against the key lower-cased with everything but letters and digits removed. */
const SENSITIVE_KEY_PART =
  /phone|mobile|email|contact|token|passw|secret|authoriz|cookie|apikey|privatekey|bank|accountnumber|accountno|ifsc|aadhaa?r|address|landmark|pincode|fullname|displayname|firstname|lastname|(holder|beneficiary|customer|booker|client|payee|payer|account|user|person|subject)name|signature|credential|dsn/;
/** Names that END like this: `payerVpa`, `customerUpi`, `lastOtp`. */
const SENSITIVE_KEY_SUFFIX = /(vpa|upi|upiid|otp|otpcode)$/;
const SENSITIVE_KEY_EXACT: ReadonlySet<string> = new Set([
  'pan',
  'pannumber',
  'lat',
  'lng',
  'latitude',
  'longitude',
  'location',
  'dob',
  'dateofbirth',
  'gstin',
]);

export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_EXACT.has(k) || SENSITIVE_KEY_SUFFIX.test(k) || SENSITIVE_KEY_PART.test(k);
}

/** UUIDs are set aside before any rule runs, so none eats or splits them (job ids embed them). */
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SHIELD_OPEN = '';
const SHIELD_CLOSE = '';
const SHIELDED = /(\d+)/g;

/** A long run that mixes letters and digits is a key, hash or token; a long identifier is not. */
const opaque = (match: string): string =>
  /\d/.test(match) && /[A-Za-z]/.test(match) ? '[token]' : match;

/**
 * Order matters (security review, 4 Nov): credentials first, then long opaque runs whole (so a
 * digit rule cannot split a secret into short surviving pieces), then contact details and ids.
 */
const TEXT_RULES: ReadonlyArray<readonly [RegExp, string | ((match: string) => string)]> = [
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/\b(Bearer|Basic) +[A-Za-z0-9._~+/=-]{8,}/g, '$1 [token]'],
  [/\/d\/[A-Za-z0-9_-]{16,}/g, '/d/[token]'],
  [/[A-Za-z0-9+=_-]{32,}/g, opaque],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}\b/g, '[upi]'],
  [/\+\d[\d\s.-]{8,16}\d/g, '[phone]'],
  [/(?<!\d)(?:(?:\+?91|0)[\s.-]?)?[6-9](?:[\s.-]?\d){9}(?!\d)/g, '[phone]'],
  [/(?<!\d)\d{4}[\s-]\d{4}[\s-]\d{4}(?!\d)/g, '[number]'],
  [/(?<!\d)\d{9,}(?!\d)/g, '[number]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[pan]'],
  [/\b[A-Z]{4}0[A-Z0-9]{6}\b/g, '[ifsc]'],
];

/** Masks personal data and credentials inside free text (messages, stacks, URLs). */
export function scrubText(text: string): string {
  const uuids: string[] = [];
  const shielded = text
    .slice(0, MAX_SCRUB_INPUT)
    .replace(/[]/g, '')
    .replace(UUIDS, (uuid) => `${SHIELD_OPEN}${uuids.push(uuid) - 1}${SHIELD_CLOSE}`);
  const scrubbed = TEXT_RULES.reduce(
    (out, [pattern, replacement]) =>
      typeof replacement === 'string'
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement),
    shielded,
  ).replace(SHIELDED, (_, i: string) => uuids[Number(i)] ?? '');
  return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
}

function scrubStack(stack: string): string {
  return scrubText(
    stack
      .split('\n')
      .slice(0, MAX_STACK_LINES + 1)
      .join('\n'),
  );
}

function scrubError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const e = error as Error & { code?: unknown; cause?: unknown; status?: unknown };
  return {
    name: error.name,
    message: scrubText(error.message),
    ...(typeof e.code === 'string' || typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.status === 'number' ? { status: e.status } : {}),
    ...(error.stack ? { stack: scrubStack(error.stack) } : {}),
    ...(e.cause === undefined ? {} : { cause: walk(e.cause, depth + 1, seen) }),
  };
}

function walkObject(value: object, depth: number, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => walk(v, depth + 1, seen));
    return value.length > MAX_ITEMS ? [...items, `[${value.length - MAX_ITEMS} more]`] : items;
  }
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .slice(0, MAX_KEYS)
    .map(([k, v]) => [k, isSensitiveKey(k) ? REDACTED : walk(v, depth + 1, seen)] as const);
  return Object.fromEntries(entries);
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return scrubText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return value.toString();
  if (value === undefined) return null;
  if (depth > MAX_DEPTH) return '[depth]';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    return value instanceof Error ? scrubError(value, depth, seen) : walkObject(value, depth, seen);
  } finally {
    seen.delete(value);
  }
}

/** A scrubbed, JSON-safe copy of anything: objects, arrays, Errors, primitives. */
export function scrubPii(value: unknown): unknown {
  return walk(value, 0, new WeakSet());
}
