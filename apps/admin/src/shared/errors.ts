import { isApiError } from '@clickco/api-client';

/**
 * What a person sees when a request fails (ADR-0025 D6): the server's own message, except a 401
 * (the session ended — back to sign-in) and a 403 (the role does not allow it).
 */
export interface DescribedError {
  readonly message: string;
  /** The session is gone: send the person to sign in again. */
  readonly signIn: boolean;
}

export const NO_ACCESS = "You don't have access to this";
export const SESSION_ENDED = 'Your session ended — sign in again';

export function describeError(error: unknown): DescribedError {
  if (isApiError(error)) {
    if (error.kind === 'HTTP' && error.status === 401) {
      return { message: SESSION_ENDED, signIn: true };
    }
    if (error.kind === 'HTTP' && error.status === 403) return { message: NO_ACCESS, signIn: false };
    return { message: error.message || 'Something went wrong', signIn: false };
  }
  if (error instanceof Error && error.message) return { message: error.message, signIn: false };
  return { message: 'Something went wrong', signIn: false };
}

/** Whether a failed request is worth retrying automatically (never a 4xx or a bad answer). */
export function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return false;
  return error.kind === 'NETWORK' || (error.kind === 'HTTP' && error.status >= 500);
}
