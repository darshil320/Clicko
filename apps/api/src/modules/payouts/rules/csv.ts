/**
 * RFC 4180 CSV for the bank file, statements and the TDS report (pure). Cells that a spreadsheet
 * would run as a formula (= + - @, tab, CR) are prefixed with an apostrophe (CSV injection):
 * names come from photographers and must never execute on a finance laptop.
 */

export type CsvValue = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export function csvCell(value: CsvValue): string {
  if (value === null) return '';
  const text = typeof value === 'number' ? String(value) : value;
  const safe = typeof value === 'string' && FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(cells: readonly CsvValue[]): string {
  return cells.map(csvCell).join(',');
}

/** Header + rows, every line ending CRLF. */
export function csvDocument(
  header: readonly string[],
  rows: ReadonlyArray<readonly CsvValue[]>,
): string {
  return [header, ...rows].map((r) => `${csvRow(r)}\r\n`).join('');
}

/** 1234550n → '12345.50': two decimals, no grouping, no floats. */
export function rupees(paise: bigint): string {
  if (paise < 0n) throw new RangeError('rupees: negative amount');
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;
}

/** 2500 bps → '25%'; 1250 → '12.5%'. */
export function percent(bps: number): string {
  return `${bps / 100}%`;
}
