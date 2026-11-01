import { formatINR } from '@clickco/utils';
import { z } from 'zod';

/**
 * Template variables (ADR-0027 D2): every value is something Clickco formats itself — a booking
 * reference, an IST time, a rupee amount, a vetted first name, a link token. Never free text
 * a user typed. Each pattern is tight enough that a message cannot carry anything else.
 */
export const BookingRef = z.string().regex(/^CLK-\d{4,10}$/, 'booking reference');

/** formatIstWhen(): "Sat 14 Nov, 4:30 pm". */
export const IstWhen = z
  .string()
  .regex(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (am|pm)$/, 'IST date and time');

/** formatIstDate(): "14 Nov 2026". */
export const IstDate = z.string().regex(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/, 'IST date');

/** formatINR() output: "₹5,767.25" or "₹500". */
export const Rupees = z.string().regex(/^₹\d{1,3}(,\d{2,3})*(\.\d{2})?$/, 'rupee amount');

/** A first name from a KYC-verified photographer record, letters only. */
export const FirstName = z.string().regex(/^[A-Za-z][A-Za-z.'-]{0,29}$/, 'first name');

/** Clickco's virtual (ExoPhone) number — never a person's. */
export const VirtualNumber = z.string().regex(/^\+?\d{8,15}$/, 'virtual number');

export const Minutes = z.string().regex(/^[1-9]\d{0,2}$/, 'minutes');

/** A /d/<token> delivery link token (HMAC-SHA256, base64url, 43 characters). */
export const LinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'link token');

/** The last four characters of a bank UTR. */
export const UtrLast4 = z.string().regex(/^[A-Z0-9]{4}$/, 'UTR last 4');

const IST_OFFSET_MS = 330 * 60_000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** Wall-clock IST fields of an instant (UTC getters on a shifted date). */
function ist(at: Date) {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  return {
    day: DAYS[d.getUTCDay()] as string,
    date: d.getUTCDate(),
    month: MONTHS[d.getUTCMonth()] as string,
    year: d.getUTCFullYear(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

export function formatIstWhen(at: Date): string {
  const t = ist(at);
  const h12 = t.hours % 12 === 0 ? 12 : t.hours % 12;
  const ampm = t.hours < 12 ? 'am' : 'pm';
  return `${t.day} ${t.date} ${t.month}, ${h12}:${String(t.minutes).padStart(2, '0')} ${ampm}`;
}

export function formatIstDate(at: Date): string {
  const t = ist(at);
  return `${t.date} ${t.month} ${t.year}`;
}

/** "Priya Shah" → "Priya"; anything outside the FirstName pattern → null (the sender skips). */
export function firstNameOf(fullName: string): string | null {
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return FirstName.safeParse(first).success ? first : null;
}

export function utrLast4(utr: string | null | undefined): string | null {
  const clean = (utr ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.length >= 4 ? clean.slice(-4) : null;
}

/** Integer paise → "₹5,767.25" (paise shown only when there are any): the Rupees pattern. */
export function formatRupees(paise: number): string {
  return formatINR(paise, { showPaise: paise % 100 !== 0 });
}
