/**
 * India Standard Time, by arithmetic. IST is UTC+05:30 with no daylight saving, so every
 * conversion is a fixed offset — no Intl, no device timezone (a client in Dubai still sees
 * the shoot in the venue's local time). DESIGN.md: dates "14 Sep", times "4:30 pm".
 */
export const IST_OFFSET_MINUTES = 330;
export const IST_OFFSET = '+05:30';
const MINUTE_MS = 60_000;
export const MINUTES_PER_DAY = 1440;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface IstParts {
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  readonly day: number;
  /** 0 = Sunday … 6 = Saturday */
  readonly weekday: number;
  /** Minutes since IST midnight, 0–1439. */
  readonly minuteOfDay: number;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function istParts(instant: Date): IstParts {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * MINUTE_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** The IST calendar date of an instant, "2026-11-14". */
export function istDateKey(instant: Date): string {
  const p = istParts(instant);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function keyParts(dateKey: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new RangeError(`not a YYYY-MM-DD date: ${dateKey}`);
  return { year: +(match[1] as string), month: +(match[2] as string), day: +(match[3] as string) };
}

/** dateKey + days, staying on the IST calendar. */
export function addDays(dateKey: string, days: number): string {
  const { year, month, day } = keyParts(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function weekdayOf(dateKey: string): number {
  const { year, month, day } = keyParts(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The instant for an IST wall-clock time, as the API's ISO-8601-with-offset form. */
export function istIso(dateKey: string, minuteOfDay: number): string {
  if (!Number.isInteger(minuteOfDay) || minuteOfDay < 0 || minuteOfDay >= MINUTES_PER_DAY) {
    throw new RangeError(`minuteOfDay out of range: ${minuteOfDay}`);
  }
  keyParts(dateKey);
  const hour = Math.trunc(minuteOfDay / 60);
  return `${dateKey}T${pad2(hour)}:${pad2(minuteOfDay % 60)}:00${IST_OFFSET}`;
}

/** "14 Sep" */
export function formatDayMonth(dateKeyOrInstant: string | Date): string {
  const { month, day } =
    typeof dateKeyOrInstant === 'string' ? keyParts(dateKeyOrInstant) : istParts(dateKeyOrInstant);
  return `${day} ${MONTHS[month - 1]}`;
}

/** "Mon" */
export function formatWeekday(dateKey: string): string {
  return WEEKDAYS[weekdayOf(dateKey)] as string;
}

const meridiem = (minuteOfDay: number): 'am' | 'pm' =>
  minuteOfDay % MINUTES_PER_DAY < 720 ? 'am' : 'pm';

function clock12(minuteOfDay: number): string {
  const m = ((minuteOfDay % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour24 = Math.trunc(m / 60);
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${pad2(m % 60)}`;
}

/** 990 → "4:30 pm", 0 → "12:00 am", 720 → "12:00 pm" */
export function formatTime(minuteOfDay: number): string {
  return `${clock12(minuteOfDay)} ${meridiem(minuteOfDay)}`;
}

/** "4:30–6:30 pm", or "11:30 am–1:30 pm" when the range crosses noon. */
export function formatTimeRange(startMinute: number, hours: number): string {
  const endMinute = startMinute + Math.round(hours * 60);
  const start = meridiem(startMinute);
  const end = meridiem(endMinute);
  return start === end
    ? `${clock12(startMinute)}–${clock12(endMinute)} ${end}`
    : `${clock12(startMinute)} ${start}–${clock12(endMinute)} ${end}`;
}

/** "14 Sep, 4:30–6:30 pm" for an API instant and a duration. */
export function formatShootWindow(iso: string, hours: number): string {
  const instant = new Date(iso);
  return `${formatDayMonth(instant)}, ${formatTimeRange(istParts(instant).minuteOfDay, hours)}`;
}

/** "14 Sep, 4:30 pm" */
export function formatDateTime(iso: string): string {
  const instant = new Date(iso);
  return `${formatDayMonth(instant)}, ${formatTime(istParts(instant).minuteOfDay)}`;
}

/** 2 → "2 hours", 2.5 → "2.5 hours", 1 → "1 hour" */
export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
