import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Staff passwords (ADR-0025 D2): Node's scrypt, N=2^15 r=8 p=1, 16-byte salt, stored as
 * `scrypt$N$r$p$salt$hash` (base64url) and compared with timingSafeEqual.
 */
export const SCRYPT_PARAMS = {
  N: 2 ** 15,
  r: 8,
  p: 1,
  saltBytes: 16,
  keyBytes: 32,
  /** 128·N·r = 32 MiB is Node's default ceiling exactly; leave headroom. */
  maxmem: 64 * 1024 * 1024,
} as const;

const TEMPORARY_PASSWORD_BYTES = 18; // 24 base64url characters

/**
 * Performance audit (ADR-0027 D6): at most this many scrypt runs at once. Each takes 32 MiB and a
 * libuv thread for ~100 ms; a burst of sign-ins would otherwise fill the 4-thread pool that file,
 * DNS and other crypto work share, and stall the whole API. The rest wait their turn in order.
 */
export const SCRYPT_MAX_CONCURRENT = 2;
/** Beyond this many waiting, a request is turned away at once (503) instead of queueing. */
export const SCRYPT_MAX_WAITING = 32;

let running = 0;
const waiting: Array<() => void> = [];

async function withScryptSlot<T>(run: () => Promise<T>): Promise<T> {
  if (running >= SCRYPT_MAX_CONCURRENT) {
    if (waiting.length >= SCRYPT_MAX_WAITING) {
      throw new ServiceUnavailableException('Sign-in is busy. Try again in a moment.');
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await run();
  } finally {
    // Hand the slot straight to the next waiter (running stays the same), or free it.
    const next = waiting.shift();
    if (next) next();
    else running -= 1;
  }
}

/** Runs in progress now (tests). */
export const scryptRunning = (): number => running;

function derive(password: string, salt: Buffer, opts: ScryptOptions, keyBytes: number) {
  return withScryptSlot(
    () =>
      new Promise<Buffer>((resolve, reject) => {
        scrypt(password.normalize('NFKC'), salt, keyBytes, opts, (error, key) =>
          error ? reject(error) : resolve(key),
        );
      }),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, saltBytes, keyBytes, maxmem } = SCRYPT_PARAMS;
  const salt = randomBytes(saltBytes);
  const key = await derive(password, salt, { N, r, p, maxmem }, keyBytes);
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

interface Parsed {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly hash: Buffer;
}

/** Only the parameters we issue are accepted: a stored hash cannot downgrade the work factor. */
function parse(stored: string): Parsed | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, salt, hash] = parts;
  const parsed = {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    salt: Buffer.from(salt ?? '', 'base64url'),
    hash: Buffer.from(hash ?? '', 'base64url'),
  };
  const ok =
    parsed.N === SCRYPT_PARAMS.N &&
    parsed.r === SCRYPT_PARAMS.r &&
    parsed.p === SCRYPT_PARAMS.p &&
    parsed.salt.length === SCRYPT_PARAMS.saltBytes &&
    parsed.hash.length === SCRYPT_PARAMS.keyBytes;
  return ok ? parsed : null;
}

/**
 * false for a wrong password AND for a malformed or foreign hash — never throws on input. An
 * unparseable hash still costs one scrypt run, so its timing matches a real account's.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) {
    const { N, r, p, saltBytes, keyBytes, maxmem } = SCRYPT_PARAMS;
    await derive(password, Buffer.alloc(saltBytes), { N, r, p, maxmem }, keyBytes);
    return false;
  }
  const key = await derive(
    password,
    parsed.salt,
    { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_PARAMS.maxmem },
    parsed.hash.length,
  );
  return timingSafeEqual(key, parsed.hash);
}

/** Shown once to the person creating the account (≥ 16 characters, 144 bits). */
export function generateTemporaryPassword(): string {
  return randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
}
