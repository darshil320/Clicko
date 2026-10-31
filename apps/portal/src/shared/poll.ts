/** Polling cadence for the portal's status screens. Pure, so it is tested without a browser. */

/** However often a poll keeps failing, it never waits longer than this. */
export const POLL_MAX_MS = 120_000;

/**
 * The wait before the next poll: `baseMs` while healthy; after n failures in a row the ceiling is
 * baseMs × 2^n (capped at `maxMs`) and the wait falls in its upper half ("equal jitter"), so
 * many open tabs do not retry a struggling API in lockstep. `random` is a fraction in [0, 1).
 */
export function pollDelay(
  baseMs: number,
  failures: number,
  random: number,
  maxMs = POLL_MAX_MS,
): number {
  if (failures <= 0) return baseMs;
  const ceiling = Math.min(Math.max(maxMs, baseMs), baseMs * 2 ** failures);
  const fraction = Math.min(Math.max(random, 0), 1);
  return Math.max(baseMs, Math.round(ceiling / 2 + (fraction * ceiling) / 2));
}
