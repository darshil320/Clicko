/** GST invoice series per Indian financial year (1 April – 31 March), judged on the IST date. */

export const INVOICE_SERIES_CODE = 'CLK-INV';

const IST_OFFSET_MS = 330 * 60_000; // IST has no daylight saving: a fixed +05:30
const FIRST_MONTH_OF_FY = 4; // April

export interface InvoiceSeriesKey {
  readonly code: string;
  /** '2026-27' */
  readonly financialYear: string;
  /** 'CLK/26-27/' — allocate_invoice_number() appends a 5-digit sequence. */
  readonly prefix: string;
}

const twoDigits = (year: number): string => String(year % 100).padStart(2, '0');

/** The calendar year the Indian financial year containing `at` (IST) started in. */
export function fyStartYear(at: Date): number {
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  const month = ist.getUTCMonth() + 1;
  return month >= FIRST_MONTH_OF_FY ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
}

export function invoiceSeriesFor(issuedAt: Date): InvoiceSeriesKey {
  const startYear = fyStartYear(issuedAt);
  const short = `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
  return {
    code: INVOICE_SERIES_CODE,
    financialYear: `${startYear}-${twoDigits(startYear + 1)}`,
    prefix: `CLK/${short}/`,
  };
}

// ── Credit notes (ADR-0026 D1, CGST Act s.34) ─────────────────────────────

export const CREDIT_NOTE_SERIES_CODE = 'CLK-CN';
const CREDIT_NOTE_DIGITS = 6;
/** s.34(2): a credit note is due by 30 November after the end of the supply's financial year. */
const CREDIT_NOTE_LAST_MONTH = 11; // November
const CREDIT_NOTE_LAST_DAY = 30;

/** 'CN/2026-27/' — its own gapless series per FY (counter kept in invoice_series as CLK-CN). */
export function creditNoteSeriesFor(issuedAt: Date): InvoiceSeriesKey {
  const startYear = fyStartYear(issuedAt);
  const financialYear = `${startYear}-${twoDigits(startYear + 1)}`;
  return { code: CREDIT_NOTE_SERIES_CODE, financialYear, prefix: `CN/${financialYear}/` };
}

/** 'CN/2026-27/' + 41 → 'CN/2026-27/000041'. */
export function creditNoteNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(CREDIT_NOTE_DIGITS, '0')}`;
}

/** The last instant (23:59:59.999 IST, 30 Nov) a credit note can reduce the invoice's output tax. */
export function creditNoteDeadline(invoiceIssuedAt: Date): Date {
  const year = fyStartYear(invoiceIssuedAt) + 1;
  const endOfDayIstAsUtc = Date.UTC(
    year,
    CREDIT_NOTE_LAST_MONTH - 1,
    CREDIT_NOTE_LAST_DAY,
    23,
    59,
    59,
    999,
  );
  return new Date(endOfDayIstAsUtc - IST_OFFSET_MS);
}

export function isCreditNoteLate(invoiceIssuedAt: Date, at: Date): boolean {
  return at.getTime() > creditNoteDeadline(invoiceIssuedAt).getTime();
}
