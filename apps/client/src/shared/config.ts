/**
 * Public, build-time configuration. EXPO_PUBLIC_* values are inlined into the bundle —
 * nothing here is, or may ever be, a secret.
 */
const DEFAULT_API_URL = 'http://localhost:4000';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');

/** Development builds only: dev OTP helper and the sandbox "Simulate payment" button. */
export const IS_DEV = typeof __DEV__ !== 'undefined' && __DEV__;

/** Dev-only endpoints are refused client-side in release builds, not just hidden. */
export function assertDevBuild(what: string): void {
  if (!IS_DEV) throw new Error(`${what} is only available in development builds`);
}

/**
 * T&C version the client accepts at checkout. T&C v2 is still a draft (OD-06/09), so the
 * booking records "v2-draft" — the same value the ops console uses — until it is published.
 */
export const TERMS_VERSION = 'v2-draft';

/** Prices on Home are shown for this pincode (Vesu, Surat) until the client sets their own. */
export const DEFAULT_PINCODE = '395007';
export const DEFAULT_CITY_NAME = 'Surat';
