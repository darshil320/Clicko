/**
 * Which state a data-backed screen or section shows (clickco-screen §6): loading, offline,
 * error, empty or ready. Picked from a TanStack-style query result; pure, so every rule is
 * unit-tested without React Native.
 *
 * - Data first: once something has loaded, a failed refresh never replaces it. The screen keeps
 *   showing it and is marked `stale` (offline or error).
 * - "Offline" is the app's own test (the Pro offline queue's: no answer at all, an ApiError of
 *   kind NETWORK), or TanStack pausing the query because the device reports no network.
 * - A failed first load always ends in offline or error, each with a Retry, so nothing spins
 *   forever. A query that is disabled (pending and idle) reads as loading: screens check their
 *   inputs (an id from the URL) before they render one.
 */

export type QueryStatus = 'pending' | 'error' | 'success';
export type FetchStatus = 'fetching' | 'paused' | 'idle';

/** The parts of a TanStack query result this reads (UseQueryResult satisfies it). */
export interface QueryLike<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly status: QueryStatus;
  readonly fetchStatus: FetchStatus;
}

export type FailureKind = 'offline' | 'error';

export interface Failure {
  readonly kind: FailureKind;
  /** One human sentence from the app (its userMessage). Never raw error text or a code. */
  readonly message: string;
}

interface Failed {
  /** One human sentence (see Failure). */
  readonly message: string;
  /** A retry is in flight: the Retry button shows it is busy. */
  readonly retrying: boolean;
}

interface Loaded<T> {
  readonly data: T;
  /** The last refresh failed; `data` is what was loaded before. */
  readonly stale: Failure | null;
}

/** One literal `kind` per member, so `if (state.kind === 'error') return` narrows the rest. */
export type ScreenState<T> =
  | { readonly kind: 'loading' }
  | ({ readonly kind: 'offline' } & Failed)
  | ({ readonly kind: 'error' } & Failed)
  | ({ readonly kind: 'empty' } & Loaded<T>)
  | ({ readonly kind: 'ready' } & Loaded<T>);

export interface ScreenStateOptions<T> {
  /** True when the request got no answer at all (the app's network test). */
  readonly isOffline: (error: unknown) => boolean;
  /** One plain sentence for a failure (the app's userMessage). */
  readonly describe: (error: unknown) => string;
  /** Defaults to: null, or an empty array. */
  readonly isEmpty?: ((data: T) => boolean) | undefined;
}

/** What a paused query (the device says it is offline) tells the person. */
export const PAUSED_MESSAGE = 'You seem to be offline. Check your connection and try again.';

/** No data to show: null, or an empty list. Objects with content are never "empty". */
export function isEmptyData(data: unknown): boolean {
  return data === null || (Array.isArray(data) && data.length === 0);
}

function failureOf<T>(error: unknown, options: ScreenStateOptions<T>): Failure {
  return {
    kind: options.isOffline(error) ? 'offline' : 'error',
    message: options.describe(error),
  };
}

const PAUSED: Failure = { kind: 'offline', message: PAUSED_MESSAGE };

/** Picks the one state to render from a query result. */
export function pickScreenState<T>(
  query: QueryLike<T>,
  options: ScreenStateOptions<T>,
): ScreenState<T> {
  const { data, error, status, fetchStatus } = query;

  if (data !== undefined) {
    const stale =
      status === 'error' ? failureOf(error, options) : fetchStatus === 'paused' ? PAUSED : null;
    const empty = (options.isEmpty ?? isEmptyData)(data);
    return { kind: empty ? 'empty' : 'ready', data, stale };
  }

  if (status === 'error') {
    const failure = failureOf(error, options);
    return { kind: failure.kind, message: failure.message, retrying: fetchStatus === 'fetching' };
  }

  if (fetchStatus === 'paused') {
    return { kind: 'offline', message: PAUSED.message, retrying: false };
  }

  return { kind: 'loading' };
}
