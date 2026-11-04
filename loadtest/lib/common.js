// Shared k6 helpers (k6 is a standalone binary: https://grafana.com/docs/k6/latest/set-up/install-k6/).
// Targets and thresholds are ADR-0029 D5. Never point these scripts at production.
import { check, fail } from 'k6';
import exec from 'k6/execution';

export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:4000').replace(/\/+$/, '');

/** Hosts a load test must never touch. */
const FORBIDDEN_HOSTS = ['api.clickco.in', 'clickco.in', 'www.clickco.in'];

/** Call from setup(): refuses production and anything that is not up. */
export function assertSafeTarget(http) {
  const host = BASE_URL.replace(/^https?:\/\//, '').split(/[/:]/)[0];
  if (FORBIDDEN_HOSTS.includes(host)) fail(`${host} is production: load tests are refused`);
  const health = http.get(`${BASE_URL}/health`, { tags: { name: 'health' } });
  if (health.status !== 200) fail(`${BASE_URL}/health answered ${health.status}`);
}

/**
 * One fake client address per VU, so the API's per-IP limits treat VUs as different people.
 * Only honoured when the target's TRUST_PROXY_HOPS is one more than its real proxy hops — set
 * that on the load-test stack only (README). Elsewhere the header is ignored, as it should be.
 */
export function vuAddress() {
  const n = exec.vu.idInTest;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

export function headers(token, extra = {}) {
  const h = { accept: 'application/json', 'x-forwarded-for': vuAddress(), ...extra };
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

export function jsonHeaders(token, extra = {}) {
  return headers(token, { 'content-type': 'application/json', ...extra });
}

/** An Idempotency-Key the API accepts (8–128 of A–Z a–z 0–9 . _ : -). */
export function idemKey(label) {
  const rand = Math.random().toString(36).slice(2, 12);
  return `lt-${label}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}-${rand}`;
}

/** The envelope's data, or null (and a failed check) when the call did not succeed. */
export function data(res, label) {
  let body = null;
  try {
    body = res.json();
  } catch (_) {
    body = null;
  }
  const ok = check(res, {
    [`${label}: 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label}: envelope success`]: () => body !== null && body.success === true,
  });
  return ok ? body.data : null;
}

/** Reads a seed file written by loadtest/seed/seed.mjs (k6 open() runs in the init context). */
export function seedFile(name) {
  const path = __ENV.SEED_DIR ? `${__ENV.SEED_DIR}/${name}` : `../.seed/${name}`;
  return JSON.parse(open(path));
}

/** Seed tokens live 15 minutes: a run must finish inside that (README). */
export const MAX_TEST_DURATION = '14m';
