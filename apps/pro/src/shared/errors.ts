import { isApiError } from '@clickco/api-client';

const UNKNOWN = 'Something went wrong. Please try again.';
const SERVER_TROUBLE = 'Something went wrong on our side. Please try again in a moment.';
const CHECK_AND_RETRY = "Something didn't look right. Please check and try again.";
const TOO_MANY_TRIES = 'Too many tries. Please wait a minute and try again.';

/**
 * The API's generic envelope codes (its exception filter's defaults and the validation pipe)
 * carry framework text such as "Forbidden resource" or "Request validation failed", not a
 * sentence for people, so they get ours. Domain codes (QUOTE_EXPIRED, OTP_INVALID…) keep the
 * API's own sentence, which is written for people.
 */
const GENERIC_CODE_COPY: Readonly<Record<string, string>> = {
  BAD_REQUEST: CHECK_AND_RETRY,
  VALIDATION_FAILED: CHECK_AND_RETRY,
  INVALID_JSON: CHECK_AND_RETRY,
  UNPROCESSABLE: CHECK_AND_RETRY,
  PAYLOAD_TOO_LARGE: 'That was too large to send. Please try something smaller.',
  UNAUTHORIZED: 'Your session has ended. Please sign in again.',
  FORBIDDEN: "You don't have access to this.",
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  CONFLICT: 'This changed in the meantime. Refresh and try again.',
  ERROR: UNKNOWN,
};

/** Framework defaults that are never a sentence for people (e.g. the rate limiter's). */
const FRAMEWORK_TEXT =
  /exception|^(too many requests|not found|forbidden( resource)?|unauthorized|bad request|conflict|internal server error)\.?$/i;

/** No answer at all: offline, DNS, timeout. The offline queue's own test (ADR-0024 D5). */
export { isOffline } from './offline/queue';

/** The api-client refuses an id from a URL that is not a UUID before sending anything. */
const INVALID_ID = 'INVALID_ID';

/**
 * A GET by id that can never succeed: 404, a 400 for a malformed id, or the api-client's own
 * INVALID_ID. Screens show "not found" with a way back instead of a pointless Retry.
 */
export const isNotFound = (error: unknown): boolean =>
  isApiError(error) &&
  error.kind === 'HTTP' &&
  (error.status === 404 || error.status === 400 || error.code === INVALID_ID);

export interface Refusal {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
}

/** The words for an answer the API refused: by code, and never framework text or a code. */
export function humanMessage({ code, message, status }: Refusal): string {
  const generic = GENERIC_CODE_COPY[code];
  if (generic) return generic;
  const sentence = message.trim();
  if (sentence !== '' && !FRAMEWORK_TEXT.test(sentence)) return sentence;
  return code === 'RATE_LIMITED' || status === 429 ? TOO_MANY_TRIES : UNKNOWN;
}

/**
 * One user-facing sentence for any failure. The API's domain messages are written for people
 * ("This quote has expired — please start a new booking"), so they pass through; generic codes,
 * transport failures and server errors get plain-language copy. Internals never reach the screen.
 */
export function userMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === 'NETWORK') {
      return error.code === 'TIMEOUT'
        ? 'Clickco is taking too long to respond. Check your connection and try again.'
        : 'You seem to be offline. Check your connection and try again.';
    }
    if (error.kind === 'INVALID_RESPONSE' || error.status >= 500) return SERVER_TROUBLE;
    return humanMessage(error);
  }
  return UNKNOWN;
}
