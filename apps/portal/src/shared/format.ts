/** Display formatting shared by the portal's features (no feature imports another). */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1 KB = 1024 B; one decimal from MB up. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 2 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** 0:42 · 12:05 · 1:02:05 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Countdown to a deadline: "4 h 12 min left" / "Overdue by 25 min". */
export function formatCountdown(
  deadlineMs: number,
  nowMs: number,
): { text: string; overdue: boolean } {
  const diffMin = Math.round((deadlineMs - nowMs) / 60_000);
  const abs = Math.abs(diffMin);
  const label = abs >= 60 ? `${Math.floor(abs / 60)} h ${abs % 60} min` : `${abs} min`;
  return diffMin >= 0
    ? { text: `${label} left`, overdue: false }
    : { text: `Overdue by ${label}`, overdue: true };
}
