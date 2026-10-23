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

export function invoiceSeriesFor(issuedAt: Date): InvoiceSeriesKey {
  const ist = new Date(issuedAt.getTime() + IST_OFFSET_MS);
  const month = ist.getUTCMonth() + 1;
  const startYear = month >= FIRST_MONTH_OF_FY ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  const short = `${twoDigits(startYear)}-${twoDigits(startYear + 1)}`;
  return {
    code: INVOICE_SERIES_CODE,
    financialYear: `${startYear}-${twoDigits(startYear + 1)}`,
    prefix: `CLK/${short}/`,
  };
}
