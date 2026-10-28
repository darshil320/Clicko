/**
 * ADR-0025 D6: a staff session signs out after 30 minutes without activity. Pure helpers; the
 * shell wires them to the browser's activity events.
 */
export const IDLE_LIMIT_MS = 30 * 60_000;
/** How often the shell checks, and how often activity is written down at most. */
export const IDLE_CHECK_MS = 30_000;
export const ACTIVITY_WRITE_MS = 15_000;

export function isIdle(lastActivityMs: number | null, nowMs: number, limitMs = IDLE_LIMIT_MS) {
  return lastActivityMs !== null && nowMs - lastActivityMs >= limitMs;
}

/** Whether enough time has passed to write a fresh activity time (keeps storage writes rare). */
export function shouldRecordActivity(lastWrittenMs: number | null, nowMs: number): boolean {
  return lastWrittenMs === null || nowMs - lastWrittenMs >= ACTIVITY_WRITE_MS;
}
