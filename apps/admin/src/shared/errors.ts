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

/** Statuses where the API refused before committing anything: nothing happened, safe to change. */
const REFUSED: ReadonlyArray<number> = [400, 401, 403, 404, 409, 422];
/** A 409 that only means "the same request is still running": its outcome is not known yet. */
const STILL_RUNNING = 'IDEMPOTENCY_REQUEST_IN_PROGRESS';

/**
 * Whether a failed money action certainly did NOT happen (security review H1): a 4xx the server
 * answers before or instead of committing — a wrong code, no access, a validation error, a
 * refusal. Anything else (offline, timeout, a 5xx, a bad answer, the same request still running)
 * may have gone through: keep the exact request and its Idempotency-Key, and retry it unchanged,
 * so the server replays its stored answer instead of acting twice.
 */
export function isDefiniteRejection(error: unknown): boolean {
  if (!isApiError(error) || error.kind !== 'HTTP') return false;
  if (!REFUSED.includes(error.status)) return false;
  return !(error.status === 409 && error.code === STILL_RUNNING);
}
