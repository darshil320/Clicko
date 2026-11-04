// Plain-Node helpers for the load-test seed (Node 22: fetch and node:crypto, no packages).
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Operator settings. Not turbo tasks, so read by name rather than listed in turbo.json. */
export const env = (name) => process.env[name];

export const SEED_DIR =
  env('SEED_DIR') ?? join(dirname(fileURLToPath(import.meta.url)), '..', '.seed');

const PRODUCTION_HOSTS = ['api.clickco.in', 'clickco.in', 'www.clickco.in'];

export class ApiFailure extends Error {
  constructor(status, code, message, details) {
    super(
      `${status} ${code}: ${message}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`,
    );
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function createApi(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const host = new URL(base).hostname;
  if (PRODUCTION_HOSTS.includes(host)) throw new Error(`${host} is production: refused`);

  /** One API call; resolves to the envelope's data or throws ApiFailure. */
  async function call(method, path, { token, json, bytes, headers = {}, idem } = {}) {
    const h = { accept: 'application/json', ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (idem) h['idempotency-key'] = idem === true ? `seed-${randomUUID()}` : idem;
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (bytes !== undefined) {
      h['content-type'] = 'application/octet-stream';
      body = bytes;
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: h,
      body,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    let env = null;
    try {
      env = text ? JSON.parse(text) : null;
    } catch {
      env = null;
    }
    if (env?.success !== true || res.status >= 400) {
      const err = env?.error ?? {};
      throw new ApiFailure(
        res.status,
        err.code ?? 'ERROR',
        err.message ?? text.slice(0, 200),
        err.details,
      );
    }
    return env.data;
  }

  return { base, call };
}

/**
 * The target must be up. Whether it has the dev tools is decided by the first OTP read
 * (`signIn`): staging and production have no /dev routes, so the seed stops there.
 */
export async function assertHealthy(api) {
  const health = await fetch(`${api.base}/health`, { signal: AbortSignal.timeout(5_000) });
  if (health.status !== 200) throw new Error(`${api.base}/health answered ${health.status}`);
}

/**
 * Phone OTP sign-in through the dev OTP peek. `kind` is 'client' or 'pro'. Returns the tokens
 * and the session's account (`user` or `photographer`).
 */
export async function signIn(api, kind, phone) {
  const prefix = kind === 'pro' ? '/pro/auth' : '/auth';
  const challenge = await api.call('POST', `${prefix}/otp/request`, {
    json: kind === 'pro' ? { phone } : { phone, purpose: 'LOGIN' },
  });
  let otp;
  try {
    otp = await api.call('GET', `/dev/otp/${encodeURIComponent(phone)}`);
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) {
      throw new Error('GET /dev/otp is missing: the target must run with DEV_TOOLS=on');
    }
    throw error;
  }
  const session = await api.call('POST', `${prefix}/otp/verify`, {
    json: { challengeId: challenge.challengeId, phone, code: otp.code, deviceId: 'loadtest-seed' },
  });
  return { tokens: pickTokens(session), account: session.user ?? session.photographer };
}

export function pickTokens(pair) {
  return {
    accessToken: pair.accessToken,
    accessTokenExpiresAt: pair.accessTokenExpiresAt,
    refreshToken: pair.refreshToken,
  };
}

export async function refresh(api, kind, tokens) {
  const path = kind === 'pro' ? '/pro/auth/refresh' : '/auth/refresh';
  return pickTokens(await api.call('POST', path, { json: { refreshToken: tokens.refreshToken } }));
}

// ── Staff (password + RFC 6238 TOTP, the dev seed's public secret by default) ───────────────

function base32(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret, at = Date.now()) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac('sha1', base32(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 0x0f;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export async function signInStaff(api) {
  const email = env('SEED_STAFF_EMAIL') ?? 'quality@clickco.test';
  const password = env('SEED_STAFF_PASSWORD') ?? 'clickco-dev-staff-only';
  const secret = env('SEED_STAFF_TOTP_SECRET') ?? 'CLICKCODEVSTAFFTOTPSECRETAAAAAAA';
  const challenge = await api.call('POST', '/admin/auth/login', { json: { email, password } });
  if (30 - (Math.floor(Date.now() / 1000) % 30) < 3) await sleep(3_500);
  const session = await api.call('POST', '/admin/auth/totp', {
    json: { challengeId: challenge.challengeId, code: totp(secret) },
  });
  return session.accessToken;
}

// ── Files and small utilities ───────────────────────────────────────────────────────────────

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A small file with a real format signature (the API checks the first bytes). */
export function syntheticFile(name, size) {
  const bytes = randomBytes(size);
  bytes.set(
    name.toUpperCase().endsWith('.DNG') ? [0x49, 0x49, 0x2a, 0x00] : [0xff, 0xd8, 0xff, 0xe0],
    0,
  );
  return bytes;
}

export function readSeed(name, fallback) {
  const path = join(SEED_DIR, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

/** Seed files hold session tokens: 0600, and loadtest/.seed/ is git-ignored. */
export function writeSeed(name, value) {
  mkdirSync(SEED_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(join(SEED_DIR, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

/** Runs `fn` over `items`, at most `limit` at a time; returns settled results in order. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
