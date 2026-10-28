/**
 * Public, build-time configuration. EXPO_PUBLIC_* values are inlined into the bundle —
 * nothing here is, or may ever be, a secret.
 */
const DEFAULT_API_URL = 'http://localhost:4000';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');

/** Development builds only: the dev OTP helper. */
export const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

/** Dev-only endpoints are refused in release builds, not just hidden. */
export function assertDevBuild(what: string): void {
  if (!IS_DEV) throw new Error(`${what} is only available in development builds`);
}

/** Where photographers upload RAW + JPEG after check-out (ADR-0014: from a computer, not the phone). */
export const UPLOAD_PORTAL_URL = (
  process.env.EXPO_PUBLIC_UPLOAD_PORTAL_URL ?? 'http://localhost:3002'
).replace(/\/+$/, '');
