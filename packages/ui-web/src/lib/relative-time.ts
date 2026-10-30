/**
 * Relative and exact times for the panel (ADR-0026 D8, DESIGN.md §Content rules): "in 2 h",
 * "3 days ago", and the exact moment in IST — "Thu, 30 Oct 2026, 4:30 pm IST" — for the
 * hover title. Always IST, whatever the browser's time zone. Pure, so it is unit-tested.
 */

export const INDIA_TIME_ZONE = 'Asia/Kolkata';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Under this, a moment is "just now" (either way). */
const JUST_NOW = 45_000;
/** Up to here we count minutes ("in 75 min" reads better than "in 1 h" for a deadline). */
const MINUTES_UNTIL = 90 * MINUTE;
const HOURS_UNTIL = 36 * HOUR;
const DAYS_UNTIL = 7 * DAY;

// en-US for the parts: its short month is "Sep" (en-IN / en-GB now say "Sept").
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: INDIA_TIME_ZONE,
  weekday: 'short',
  year: 'numeric',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function istParts(at: number): Readonly<Record<string, string>> {
  return Object.fromEntries(PARTS.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
}

const toMs = (at: string | number | Date): number =>
  at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;

/** "Thu, 30 Oct 2026, 4:30 pm IST" */
export function formatIstExact(at: string | number | Date): string {
  const p = istParts(toMs(at));
  const period = (p.dayPeriod ?? '').toLowerCase();
  return `${p.weekday}, ${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${period} IST`;
}

/** "30 Oct" — for a moment more than a week away. */
export function formatIstDate(at: string | number | Date): string {
  const p = istParts(toMs(at));
  return `${p.day} ${p.month}`;
}

/** "Thu, 30 Oct" — the Today page's date line. */
export function formatIstWeekdayDate(at: string | number | Date): string {
  const p = istParts(toMs(at));
  return `${p.weekday}, ${p.day} ${p.month}`;
}

const count = (n: number, unit: string, units: string): string => `${n} ${n === 1 ? unit : units}`;

/**
 * "just now", "in 20 min", "5 min ago", "in 2 h", "3 h ago", "in 2 days", "3 days ago"; beyond
 * a week, the IST date ("14 Sep"). Minutes are counted up to 90 so a near deadline stays exact.
 */
export function formatRelative(at: string | number | Date, now: number): string {
  const diff = toMs(at) - now;
  const span = Math.abs(diff);
  const say = (text: string) => (diff >= 0 ? `in ${text}` : `${text} ago`);
  if (!Number.isFinite(span)) return '';
  if (span < JUST_NOW) return 'just now';
  if (span < MINUTES_UNTIL) return say(`${Math.max(1, Math.round(span / MINUTE))} min`);
  if (span < HOURS_UNTIL) return say(`${Math.round(span / HOUR)} h`);
  if (span < DAYS_UNTIL) return say(count(Math.round(span / DAY), 'day', 'days'));
  return formatIstDate(at);
}
