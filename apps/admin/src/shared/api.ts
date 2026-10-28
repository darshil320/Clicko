'use client';

import { createAdminApiClient } from '@clickco/api-client';
import { resolveApiUrl } from './security-headers';
import { sessionTokens } from './session';
import { signOut } from './sign-out';

/** Public base URL of the API (not a secret). */
export const API_URL = resolveApiUrl(process.env.NEXT_PUBLIC_API_URL, false);

/** The one admin API client. A refused refresh token ends the session and returns to sign-in. */
export const adminApi = createAdminApiClient({
  baseUrl: API_URL,
  tokens: sessionTokens,
  onSessionExpired: () => signOut('expired'),
});
