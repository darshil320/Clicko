import { createApiClient } from '@clickco/api-client';
import { API_URL } from './config';
import { sessionTokenStore } from './session/store';

/**
 * The one API client. Features call it from their api.ts only; screens never fetch.
 * When a refresh token is rejected the session is cleared, and the root layout's
 * Stack.Protected guard sends the user back to sign-in.
 */
export const api = createApiClient({ baseUrl: API_URL, tokens: sessionTokenStore });
