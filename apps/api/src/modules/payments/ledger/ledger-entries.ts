/**
 * Double-entry postings (doc 05 §9). Pure: builds balanced line sets; LedgerService writes them.
 * Revenue and GST are recognised at invoice issue, not at payment (keeps GSTR-1 reconcilable).
 */
import { roundHalfUp } from '@clickco/utils';

export const LEDGER_ACCOUNTS = {
  CASH_GATEWAY: 'CASH_GATEWAY',
  CLIENT_RECEIVABLE: 'CLIENT_RECEIVABLE',
  REVENUE_SERVICE: 'REVENUE_SERVICE',
  REVENUE_TRAVEL: 'REVENUE_TRAVEL',
  GST_OUTPUT_PAYABLE: 'GST_OUTPUT_PAYABLE',
  VENDOR_PAYABLE: 'VENDOR_PAYABLE',
  TDS_PAYABLE: 'TDS_PAYABLE',
  COGS_VENDOR: 'COGS_VENDOR',
  GATEWAY_FEES: 'GATEWAY_FEES',
  REFUNDS_ISSUED: 'REFUNDS_ISSUED',
  CLIENT_CREDITS_LIABILITY: 'CLIENT_CREDITS_LIABILITY',
  SLA_REMEDY_EXPENSE: 'SLA_REMEDY_EXPENSE',
} as const;
export type LedgerAccount = keyof typeof LEDGER_ACCOUNTS;

export type TxnKind =
  | 'ADVANCE_CAPTURED'
  | 'BALANCE_CAPTURED'
  | 'REFUND_ISSUED'
  | 'PAYOUT_PAID'
  | 'GST_ACCRUED'
  | 'TDS_WITHHELD'
  | 'CREDIT_ISSUED'
  | 'CREDIT_REDEEMED'
  | 'GATEWAY_FEE';

export interface LedgerLine {
  readonly account: LedgerAccount;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountPaise: bigint;
}

export class LedgerImbalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerImbalanceError';
  }
}

/** Debits = credits, every amount > 0, at least one line. The DB trigger re-checks at commit. */
export function assertBalanced(lines: readonly LedgerLine[]): void {
  if (lines.length === 0) throw new LedgerImbalanceError('A ledger txn needs at least one line');
  if (lines.some((l) => l.amountPaise <= 0n)) {
    throw new LedgerImbalanceError('Ledger amounts must be positive');
  }
  const net = lines.reduce(
    (sum, l) => (l.direction === 'DEBIT' ? sum + l.amountPaise : sum - l.amountPaise),
    0n,
  );
  if (net !== 0n) throw new LedgerImbalanceError(`Ledger txn is unbalanced by ${net} paise`);
}

const debit = (account: LedgerAccount, amountPaise: bigint): LedgerLine => ({
  account,
  direction: 'DEBIT',
  amountPaise,
});
const credit = (account: LedgerAccount, amountPaise: bigint): LedgerLine => ({
  account,
  direction: 'CREDIT',
  amountPaise,
});
const nonZero = (lines: readonly LedgerLine[]): LedgerLine[] =>
  lines.filter((l) => l.amountPaise !== 0n);

export function advanceCapturedEntries(capturedPaise: bigint): LedgerLine[] {
  return [debit('CASH_GATEWAY', capturedPaise), credit('CLIENT_RECEIVABLE', capturedPaise)];
}

export function gatewayFeeEntries(feePaise: bigint): LedgerLine[] {
  return [debit('GATEWAY_FEES', feePaise), credit('CASH_GATEWAY', feePaise)];
}

export interface GstAccrual {
  readonly invoiceTotalPaise: bigint;
  readonly taxablePaise: bigint;
  /** Portion of the taxable value that is travel (see travelShareOf). */
  readonly travelSharePaise: bigint;
}

/** Invoice issue: Dr receivable for the total; Cr service revenue, travel revenue and output GST. */
export function gstAccruedEntries(a: GstAccrual): LedgerLine[] {
  return nonZero([
    debit('CLIENT_RECEIVABLE', a.invoiceTotalPaise),
    credit('REVENUE_SERVICE', a.taxablePaise - a.travelSharePaise),
    credit('REVENUE_TRAVEL', a.travelSharePaise),
    credit('GST_OUTPUT_PAYABLE', a.invoiceTotalPaise - a.taxablePaise),
  ]);
}

/**
 * Travel's share of an invoice's taxable value, in proportion to the snapshot's pre-discount
 * subtotal (so a discount reduces travel and service revenue pro rata). Rounded half-up once;
 * service revenue takes the remainder, so the posting balances exactly.
 */
export function travelShareOf(
  invoiceTaxablePaise: bigint,
  snapshot: { readonly travelPaise: bigint; readonly subtotalPaise: bigint },
): bigint {
  if (snapshot.subtotalPaise <= 0n || snapshot.travelPaise <= 0n) return 0n;
  const share = roundHalfUp(invoiceTaxablePaise * snapshot.travelPaise, snapshot.subtotalPaise);
  return share > invoiceTaxablePaise ? invoiceTaxablePaise : share;
}
