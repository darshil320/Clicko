/**
 * The monthly TDS report for the CA (ADR-0026 D3), pure: every payout credited in the month, with
 * PAN, section, amount, TDS and the date of credit — enough to deposit by the 7th, file 26Q and
 * issue Form 16A. A missing PAN is written as PANNOTAVBL, as Form 26Q expects.
 */
import { csvDocument, percent, rupees } from './csv';

export const PAN_NOT_AVAILABLE = 'PANNOTAVBL';

export interface TdsReportRow {
  readonly name: string;
  readonly pan: string | null;
  readonly section: string | null;
  readonly rateBps: number;
  readonly grossPaise: bigint;
  readonly tdsPaise: bigint;
  readonly creditedOn: string;
  readonly payoutReference: string;
  readonly bookingReference: string;
  readonly note: string | null;
}

const HEADER = [
  'Deductee name',
  'PAN',
  'Section',
  'Rate',
  'Amount paid or credited (INR)',
  'TDS (INR)',
  'Date of credit',
  'Payment reference',
  'Booking',
  'Note',
];

export function tdsReportCsv(rows: readonly TdsReportRow[]): string {
  return csvDocument(
    HEADER,
    rows.map((r) => [
      r.name,
      r.pan ?? PAN_NOT_AVAILABLE,
      r.section ?? '',
      percent(r.rateBps),
      rupees(r.grossPaise),
      rupees(r.tdsPaise),
      r.creditedOn,
      r.payoutReference,
      r.bookingReference,
      r.note ?? '',
    ]),
  );
}
