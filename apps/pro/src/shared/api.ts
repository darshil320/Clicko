import { createProApiClient } from '@clickco/api-client';
import { API_URL } from './config';
import { sessionTokenStore } from './session/store';

/**
 * The one API client (`/pro/*`, refreshing at /pro/auth/refresh). Features call it from their
 * api.ts only; screens never fetch. A rejected refresh token clears the session, and the root
 * layout's Stack.Protected guard returns to sign-in.
 */
export const api = createProApiClient({ baseUrl: API_URL, tokens: sessionTokenStore });
