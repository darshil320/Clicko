import { formatDate, formatTime, istDay } from '../../shared/format';

/**
 * The pricing desk's number handling (ADR-0026 D4/D8). Money is typed in ₹ and sent as integer
 * paise; shares in %, price factors as "1.15×" — all parsed from text with integer arithmetic,
 * never through a float.
 */

/** "₹1,20,000.50" → 12000050. null when it is not an amount. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!m) return null;
  const whole = Number(m[1]);
  const fraction = Number((m[2] ?? '').padEnd(2, '0'));
  return whole * 100 + fraction;
}

/** 12000050 → "120000.50" (what the input starts with). */
export function paiseToRupeesText(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

/** A decimal with at most `places` places → integer scaled by 10^places, or null. */
function scaled(text: string, places: number): number | null {
  const m = /^(\d{1,6})(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const fraction = m[2] ?? '';
  if (fraction.length > places) return null;
  return Number(m[1]) * 10 ** places + Number(fraction.padEnd(places, '0') || '0');
}

/** "62.5%" → 6250 bps. */
export function percentTextToBps(text: string): number | null {
  return scaled(text.replace(/[%\s]/g, ''), 2);
}

/** 6250 → "62.5". */
export function bpsToPercentText(bps: number): string {
  return String(bps / 100);
}

/** "1.15×" → 11500 bps. */
export function factorToBps(text: string): number | null {
  const s = scaled(text.replace(/[×x\s]/gi, ''), 2);
  return s === null ? null : s * 100;
}

/** 11500 → "1.15×". */
export function bpsToFactor(bps: number): string {
  return `${(bps / 10_000).toFixed(2)}×`;
}

/** 11500 → "+15%", 9000 → "−10%", 10000 → "No change" (a factor as a person reads it). */
export function upliftLabel(bps: number): string {
  if (bps === 10_000) return 'No change';
  const pct = (bps - 10_000) / 100;
  return pct > 0 ? `+${pct}%` : `−${-pct}%`;
}

/** A change this large (±25 %) gets a warning in the review: the typo guard. */
export const LARGE_CHANGE_BPS = 2_500;

export interface Change {
  readonly direction: 'up' | 'down' | 'same';
  /** "+5.9%" — null when there was nothing before. */
  readonly percent: string | null;
  readonly large: boolean;
}

export function changeOf(before: number, after: number): Change {
  const direction = after > before ? 'up' : after < before ? 'down' : 'same';
  if (before === 0) return { direction, percent: after === 0 ? '0%' : null, large: after !== 0 };
  const tenths = Math.round(((after - before) * 1000) / before);
  const percent =
    tenths === 0 ? '0%' : `${tenths > 0 ? '+' : '−'}${(Math.abs(tenths) / 10).toFixed(1)}%`;
  return {
    direction,
    percent,
    large: Math.abs(after - before) * 10_000 >= LARGE_CHANGE_BPS * before,
  };
}

/**
 * The publish dialog's promise, in plain words: "New bookings from 4:30 pm today use version
 * 2026.10.30. Existing bookings keep their price …"
 */
export function publishSentence(p: {
  readonly version: string;
  /** null = now. */
  readonly at: number | null;
  readonly now: number;
}): string {
  const when =
    p.at === null
      ? 'from now on'
      : istDay(p.at) === istDay(p.now)
        ? `from ${formatTime(p.at)} today`
        : `from ${formatDate(p.at)}, ${formatTime(p.at)}`;
  return `New bookings ${when} use version ${p.version}. Existing bookings keep their price, and quotes already shown stay valid until they expire (15 minutes).`;
}
