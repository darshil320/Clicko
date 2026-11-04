/**
 * Sign-ins for the three actors: the client and the photographer by phone OTP (the code is read
 * from the dev endpoint, which exists only with DEV_TOOLS=on), staff by password + authenticator.
 */

import {
  type AdminApiClient,
  type ApiClient,
  createAdminApiClient,
  createApiClient,
  createProApiClient,
  type ProApiClient,
  type TokenStore,
} from './sdk.js';
import type { SavedTokens } from './state.js';
import { secondsLeftInStep, totp } from './totp.js';

/** A TokenStore in memory that reports every change, so the run file always has the latest. */
export function tokenStore(
  initial: SavedTokens | undefined,
  onChange: (tokens: SavedTokens | undefined) => void,
): TokenStore {
  let current = initial;
  return {
    getAccessToken: () => current?.accessToken ?? null,
    getRefreshToken: () => current?.refreshToken ?? null,
    setTokens: (pair) => {
      current = {
        accessToken: pair.accessToken,
        accessTokenExpiresAt: pair.accessTokenExpiresAt,
        refreshToken: pair.refreshToken,
        refreshTokenExpiresAt: pair.refreshTokenExpiresAt,
      };
      onChange(current);
    },
    clear: () => {
      current = undefined;
      onChange(undefined);
    },
  };
}

export const clientApi = (baseUrl: string, tokens: TokenStore): ApiClient =>
  createApiClient({ baseUrl, tokens, timeoutMs: 30_000 });

export const proApi = (baseUrl: string, tokens: TokenStore): ProApiClient =>
  createProApiClient({ baseUrl, tokens, timeoutMs: 30_000 });

export async function signInClient(api: ApiClient, tokens: TokenStore, phone: string) {
  const challenge = await api.auth.requestOtp({ phone, purpose: 'LOGIN' });
  const { code } = await api.dev.latestOtp(phone);
  const session = await api.auth.verifyOtp({
    challengeId: challenge.challengeId,
    phone,
    code,
    deviceId: 'dry-run',
  });
  tokens.setTokens(session);
  return session.user;
}

export async function signInPro(api: ProApiClient, tokens: TokenStore, phone: string) {
  const challenge = await api.auth.requestOtp(phone);
  const { code } = await api.dev.latestOtp(phone);
  const session = await api.auth.verifyOtp({
    challengeId: challenge.challengeId,
    phone,
    code,
    deviceId: 'dry-run',
  });
  tokens.setTokens(session);
  return session.photographer;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Password, then the authenticator code. Waits out the last 3 s of a step so the code is fresh. */
export async function signInStaff(
  baseUrl: string,
  email: string,
  password: string,
  totpSecret: string,
): Promise<AdminApiClient> {
  const tokens = tokenStore(undefined, () => {});
  const admin = createAdminApiClient({ baseUrl, tokens, timeoutMs: 30_000 });
  const challenge = await admin.auth.login({ email, password });
  if (challenge.step !== 'TOTP') {
    throw new Error(`${email} must finish enrolment in the panel first (step ${challenge.step})`);
  }
  if (secondsLeftInStep() < 3) await sleep(3_500);
  const session = await admin.auth.totp({
    challengeId: challenge.challengeId,
    code: totp(totpSecret),
  });
  tokens.setTokens(session);
  return admin;
}
