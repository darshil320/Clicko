/**
 * The offer feed's poll cadence (ADR-0024 D3: no push until S11). Pure: the hook feeds it the
 * TanStack query state and keeps the error baseline between calls.
 */

/** Healthy cadence. */
export const OFFER_POLL_MS = 10_000;
/** After repeated failures the feed never waits longer than this. */
export const OFFER_POLL_MAX_MS = 120_000;

/** The parts of TanStack's QueryState the cadence reads. */
export interface PollQueryState {
  readonly status: 'pending' | 'error' | 'success';
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
  /** Failed fetches over the query's life (after retries); never reset by a success. */
  readonly errorUpdateCount: number;
}

/** The error count as of the last successful fetch, so failures can be counted in a row. */
export interface ErrorBaseline {
  readonly dataUpdatedAt: number;
  readonly errorCount: number;
}

export const INITIAL_BASELINE: ErrorBaseline = { dataUpdatedAt: 0, errorCount: 0 };

/** A new baseline when fresh data has landed since the last one; the same object otherwise. */
export function nextBaseline(state: PollQueryState, baseline: ErrorBaseline): ErrorBaseline {
  return state.dataUpdatedAt === baseline.dataUpdatedAt
    ? baseline
    : { dataUpdatedAt: state.dataUpdatedAt, errorCount: state.errorUpdateCount };
}

/**
 * Exponential backoff with "equal jitter": after n failures in a row the ceiling is
 * base × 2^n (capped), and the wait is somewhere in its upper half — never below the healthy
 * cadence, never above the cap. `jitter` is a fraction in [0, 1).
 */
export function backoffDelay(
  failures: number,
  jitter: number,
  baseMs = OFFER_POLL_MS,
  maxMs = OFFER_POLL_MAX_MS,
): number {
  if (failures <= 0) return baseMs;
  const ceiling = Math.min(maxMs, baseMs * 2 ** failures);
  const fraction = Math.min(Math.max(jitter, 0), 1);
  return Math.max(baseMs, Math.round(ceiling / 2 + (fraction * ceiling) / 2));
}

/**
 * A stable jitter fraction for one failure, from the instant it was recorded. TanStack
 * recomputes the interval on every render; a fresh Math.random() each time would keep
 * resetting the timer, while the millisecond of the failure differs from device to device.
 */
export const jitterOf = (errorUpdatedAt: number): number => (errorUpdatedAt % 1000) / 1000;

/** How long to wait before the next poll: 10 s when healthy, backing off while it keeps failing. */
export function offerPollDelay(state: PollQueryState, baseline: ErrorBaseline): number {
  if (state.status !== 'error') return OFFER_POLL_MS;
  const failures = Math.max(1, state.errorUpdateCount - baseline.errorCount);
  return backoffDelay(failures, jitterOf(state.errorUpdatedAt));
}
