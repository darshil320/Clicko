import type { EmergencyBand } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';

/**
 * Display formatting for the panel (DESIGN.md §Content rules): ₹ with Indian grouping, dates as
 * DD MMM, times 12-hour with am/pm, all in IST whatever the browser's zone.
 */

export const INDIA_TIME_ZONE = 'Asia/Kolkata';

// en-US for the parts: its short month is "Sep" (en-IN / en-GB now say "Sept").
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: INDIA_TIME_ZONE,
  year: 'numeric',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function parts(at: string | number): Readonly<Record<string, string>> {
  const date = new Date(typeof at === 'string' ? Date.parse(at) : at);
  return Object.fromEntries(PARTS.formatToParts(date).map((p) => [p.type, p.value]));
}

/** "₹11,534" — paise in, rupees out (rounded half-up). `exact` keeps the paise: "₹11,534.50". */
export function formatMoney(paise: number, exact = false): string {
  return formatINR(paise, { showPaise: exact });
}

/** "14 Sep" */
export function formatDate(at: string | number): string {
  const p = parts(at);
  return `${p.day} ${p.month}`;
}

/** "4:30 pm" */
export function formatTime(at: string | number): string {
  const p = parts(at);
  return `${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()}`;
}

/** "14 Sep, 4:30 pm" */
export function formatDateTime(at: string | number): string {
  return `${formatDate(at)}, ${formatTime(at)}`;
}

/** An IST calendar day ("2026-11-14") as "14 Nov". */
export function formatDay(isoDate: string): string {
  return formatDate(`${isoDate}T12:00:00+05:30`);
}

/** Today's IST calendar day as YYYY-MM-DD (for date inputs). */
export function istDay(at: number): string {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
  return day;
}

/** "SEMI_PRO" → "Semi pro"; "ops.alert" → "Ops alert": codes shown to a person. */
const EMERGENCY_BAND_LABEL: Readonly<Record<EmergencyBand, string>> = {
  NONE: 'None',
  NEXT_DAY: 'Next day',
  SAME_DAY: 'Same day',
  HOURS_3_8: 'Emergency · 3–8 h',
  HOURS_UNDER_3: 'Emergency · under 3 h',
};

/** "HOURS_3_8" → "Emergency · 3–8 h" (doc 05 §8 lead-time bands). */
export const formatEmergencyBand = (band: EmergencyBand): string => EMERGENCY_BAND_LABEL[band];

export function formatCode(code: string): string {
  const words = code
    .toLowerCase()
    .split(/[_.\s]+/)
    .filter(Boolean)
    .join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** 80 → "1 h 20 min"; 45 → "45 min"; 120 → "2 h". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.trunc(minutes));
  const h = Math.trunc(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 1 → "1 hr", 2.5 → "2.5 hrs". */
export function formatHours(hours: number): string {
  return `${hours} ${hours === 1 ? 'hr' : 'hrs'}`;
}

/** A deadline from now: "in 2 h 5 min" or "25 min overdue". */
export function formatDue(dueAt: string, nowMs: number): { text: string; overdue: boolean } {
  const diff = Math.round((Date.parse(dueAt) - nowMs) / 60_000);
  return diff >= 0
    ? { text: `in ${formatMinutes(diff)}`, overdue: false }
    : { text: `${formatMinutes(-diff)} overdue`, overdue: true };
}

/** Basis points as a percentage: 2500 → "25%", 1250 → "12.5%". */
export function formatBps(bps: number): string {
  return `${bps / 100}%`;
}

/** "+919876543210" → "+91 98765 43210". Masked or foreign numbers are shown as sent. */
export function formatPhone(phone: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return m ? `+91 ${m[1]} ${m[2]}` : phone;
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
