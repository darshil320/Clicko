/**
 * The self-billed payout statement (ADR-0026 D3), pure: one per photographer per batch.
 * Photographers are generally not registered for GST, so Clickco issues the statement on their
 * behalf and no GST is charged. A registered photographer's own tax invoice is recorded
 * separately (`vendor_invoices`).
 */
import { csvDocument, csvRow, percent, rupees } from './csv';

export interface StatementLine {
  readonly bookingReference: string;
  readonly eligibleOn: string;
  readonly grossPaise: bigint;
  readonly tdsSection: string | null;
  readonly tdsRateBps: number;
  readonly tdsPaise: bigint;
  readonly deductionsPaise: bigint;
  readonly netPaise: bigint;
}

export interface StatementDeduction {
  readonly label: string;
  readonly bookingReference: string;
  readonly rateBps: number;
  readonly basisPaise: bigint;
  readonly amountPaise: bigint;
}

export interface Statement {
  readonly batchReference: string;
  readonly issuedOn: string;
  readonly photographerName: string;
  readonly pan: string | null;
  readonly gstRegistered: boolean;
  readonly transferReference: string | null;
  readonly utr: string | null;
  readonly lines: readonly StatementLine[];
  readonly deductions: readonly StatementDeduction[];
  readonly totals: {
    readonly grossPaise: bigint;
    readonly broughtForwardPaise: bigint;
    readonly deductionsPaise: bigint;
    readonly tdsPaise: bigint;
    readonly netPaise: bigint;
    readonly carriedForwardPaise: bigint;
  };
}

const LINE_HEADER = [
  'Booking',
  'Due on',
  'Earned (INR)',
  'TDS section',
  'TDS rate',
  'TDS (INR)',
  'Deductions (INR)',
  'Net (INR)',
];
const DEDUCTION_HEADER = ['Deduction', 'Booking', 'Rate', 'Of (INR)', 'Amount (INR)'];

export function statementCsv(s: Statement): string {
  const head = [
    ['Self-billed payout statement'],
    ['Issued by', 'Clickco, on behalf of the photographer'],
    ['Photographer', s.photographerName],
    ['PAN', s.pan ?? 'Not on file'],
    ['Batch', s.batchReference],
    ['Issued on', s.issuedOn],
    ['Payment reference', s.transferReference ?? ''],
    ['Bank reference (UTR)', s.utr ?? ''],
    [],
  ];
  const lines = s.lines.map((l) => [
    l.bookingReference,
    l.eligibleOn,
    rupees(l.grossPaise),
    l.tdsSection ?? '',
    percent(l.tdsRateBps),
    rupees(l.tdsPaise),
    rupees(l.deductionsPaise),
    rupees(l.netPaise),
  ]);
  const deductions = s.deductions.map((d) => [
    d.label,
    d.bookingReference,
    percent(d.rateBps),
    rupees(d.basisPaise),
    rupees(d.amountPaise),
  ]);
  const t = s.totals;
  const totals = [
    [],
    ['Earned', rupees(t.grossPaise)],
    ['Brought forward (owed from earlier payouts)', rupees(t.broughtForwardPaise)],
    ['Deductions recovered', rupees(t.deductionsPaise)],
    ['TDS', rupees(t.tdsPaise)],
    ['Paid to your bank', rupees(t.netPaise)],
    ['Carried forward to your next payout', rupees(t.carriedForwardPaise)],
    [],
    [
      s.gstRegistered
        ? 'GST-registered photographer: your own tax invoice is recorded separately.'
        : 'You are not registered for GST, so no GST is charged on this statement.',
    ],
  ];
  return [
    ...head.map((r) => `${csvRow(r)}\r\n`),
    csvDocument(LINE_HEADER, lines),
    deductions.length > 0 ? `\r\n${csvDocument(DEDUCTION_HEADER, deductions)}` : '',
    ...totals.map((r) => `${csvRow(r)}\r\n`),
  ].join('');
}
