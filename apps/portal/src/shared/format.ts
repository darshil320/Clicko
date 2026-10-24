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

/** Clickco operates in India: dates and times are shown in IST whatever the browser's zone. */
const INDIA_TIME_ZONE = 'Asia/Kolkata';

// en-US for the parts: its short month is "Sep" (en-IN / en-GB now say "Sept").
const DATE_TIME_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: INDIA_TIME_ZONE,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function parts(at: string | number): Readonly<Record<string, string>> {
  const date = new Date(typeof at === 'string' ? Date.parse(at) : at);
  return Object.fromEntries(DATE_TIME_PARTS.formatToParts(date).map((p) => [p.type, p.value]));
}

/** "14 Sep" (DESIGN.md: dates are DD MMM). */
export function formatDate(at: string | number): string {
  const p = parts(at);
  return `${p.day} ${p.month}`;
}

/** "14 Sep, 4:30 pm" (DESIGN.md: 12-hour times with am/pm). */
export function formatDateTime(at: string | number): string {
  const p = parts(at);
  return `${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()}`;
}

/** "SEMI_PRO" → "Semi Pro": enum codes shown to a person. */
export function formatCode(code: string): string {
  return code
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** "Vikram Reddy" → "VR", for the avatar. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return letters || '?';
}
