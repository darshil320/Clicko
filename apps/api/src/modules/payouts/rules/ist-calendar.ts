/**
 * IST calendar arithmetic for payouts (pure). IST is a fixed UTC+05:30 with no daylight saving:
 * shift, truncate in UTC terms, shift back.
 */
import { PAYOUT_CONFIG } from '../payouts.config';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const APRIL = 3; // 0-based month index
const MARCH = 2;

const local = (at: Date): Date => new Date(at.getTime() + IST_OFFSET_MS);
const fromLocalUtc = (localUtcMs: number): Date => new Date(localUtcMs - IST_OFFSET_MS);
const pad = (n: number): string => String(n).padStart(2, '0');

/** '2026-11-02' — the IST calendar day. */
export function istDate(at: Date): string {
  const l = local(at);
  return `${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}-${pad(l.getUTCDate())}`;
}

/** '2026-11' — the IST calendar month. */
export function istMonth(at: Date): string {
  return istDate(at).slice(0, 7);
}

/** Monday 00:00 IST of the ISO week containing `at`. */
export function istWeekStart(at: Date): Date {
  const l = local(at);
  const day = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
  const isoWeekday = l.getUTCDay() === 0 ? 7 : l.getUTCDay();
  return fromLocalUtc(day - (isoWeekday - 1) * DAY_MS);
}

export function isIstMonday(at: Date): boolean {
  return local(at).getUTCDay() === 1;
}

/** Next Monday 00:00 IST after this week's (the next weekly run). */
export function nextIstWeekStart(at: Date): Date {
  return new Date(istWeekStart(at).getTime() + 7 * DAY_MS);
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`not a month: ${month}`);
  return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

/** [start, end) of an IST calendar month. */
export function monthRange(month: string): { start: Date; end: Date } {
  const { year, monthIndex } = parseMonth(month);
  return {
    start: fromLocalUtc(Date.UTC(year, monthIndex, 1)),
    end: fromLocalUtc(Date.UTC(year, monthIndex + 1, 1)),
  };
}

export interface FinancialYear {
  /** '2026-27' */
  readonly label: string;
  /** 1 April 00:00 IST. */
  readonly start: Date;
  /** The next 1 April 00:00 IST (exclusive). */
  readonly end: Date;
}

function financialYearStarting(startYear: number): FinancialYear {
  return {
    label: `${startYear}-${pad((startYear + 1) % 100)}`,
    start: fromLocalUtc(Date.UTC(startYear, APRIL, 1)),
    end: fromLocalUtc(Date.UTC(startYear + 1, APRIL, 1)),
  };
}

/** The Indian financial year (1 April – 31 March, IST) containing `at`. */
export function financialYearOf(at: Date): FinancialYear {
  const l = local(at);
  const startYear = l.getUTCMonth() >= APRIL ? l.getUTCFullYear() : l.getUTCFullYear() - 1;
  return financialYearStarting(startYear);
}

export function financialYearFromLabel(label: string): FinancialYear {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m || (Number(m[1]) + 1) % 100 !== Number(m[2])) {
    throw new RangeError(`not a financial year: ${label}`);
  }
  return financialYearStarting(Number(m[1]));
}

/** '2026-04' … '2027-03'. */
export function monthsOf(fy: FinancialYear): string[] {
  const startYear = Number(fy.label.slice(0, 4));
  return Array.from({ length: 12 }, (_, i) => {
    const monthIndex = (APRIL + i) % 12;
    const year = monthIndex >= APRIL ? startYear : startYear + 1;
    return `${year}-${pad(monthIndex + 1)}`;
  });
}

/** TDS deducted in `month` is deposited by the 7th of the next month; March's by 30 April. */
export function tdsDepositDueOn(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = (monthIndex + 1) % 12;
  const day = monthIndex === MARCH ? PAYOUT_CONFIG.tdsMarchDepositDay : PAYOUT_CONFIG.tdsDepositDay;
  return `${nextYear}-${pad(nextMonth + 1)}-${pad(day)}`;
}
