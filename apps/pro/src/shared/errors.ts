import { isApiError } from '@clickco/api-client';

/**
 * One user-facing sentence for any failure. The API's messages are written for people
 * ("This quote has expired — please start a new booking"), so HTTP errors pass through;
 * transport failures get a plain-language fallback. Internals never reach the screen.
 */
export function userMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === 'NETWORK') {
      return error.code === 'TIMEOUT'
        ? 'Clickco is taking too long to respond. Check your connection and try again.'
        : 'You seem to be offline. Check your connection and try again.';
    }
    if (error.kind === 'INVALID_RESPONSE' || error.status >= 500) {
      return 'Something went wrong on our side. Please try again in a moment.';
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
