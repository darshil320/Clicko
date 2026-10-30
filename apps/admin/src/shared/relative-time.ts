/** "3 days ago", "in 2 h", "just now" — next to the exact IST time (ADR-0026 D8). */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatAgo(at: string, nowMs: number): string {
  const diff = nowMs - Date.parse(at);
  const ahead = diff < 0;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return 'just now';
  const [n, unit] =
    abs < HOUR
      ? [Math.floor(abs / MINUTE), 'min']
      : abs < DAY
        ? [Math.floor(abs / HOUR), 'h']
        : [Math.floor(abs / DAY), Math.floor(abs / DAY) === 1 ? 'day' : 'days'];
  return ahead ? `in ${n} ${unit}` : `${n} ${unit} ago`;
}
