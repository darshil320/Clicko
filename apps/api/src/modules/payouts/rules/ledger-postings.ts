/**
 * Payout postings (doc 05 §9), pure. LedgerService writes them, one balanced txn each:
 *   PAYOUT_ACCRUED    vendor invoice raised     Dr COGS_VENDOR        Cr VENDOR_PAYABLE
 *   TDS_WITHHELD      on credit                 Dr VENDOR_PAYABLE     Cr TDS_PAYABLE
 *   PAYOUT_DEDUCTION  deduction recognised      Dr VENDOR_RECOVERABLE Cr VENDOR_DEDUCTIONS
 *                     … recovered from payout   Dr VENDOR_PAYABLE     Cr VENDOR_RECOVERABLE
 *   PAYOUT_PAID       bank confirms (UTR)       Dr VENDOR_PAYABLE     Cr CASH_GATEWAY
 * VENDOR_PAYABLE per payout ends at zero once paid; VENDOR_RECOVERABLE per photographer is what
 * is carried forward.
 */
import type { LedgerAccount, LedgerLine } from '../../payments/ledger/ledger-entries';

const line = (
  account: LedgerAccount,
  direction: LedgerLine['direction'],
  amountPaise: bigint,
): LedgerLine => {
  if (amountPaise < 0n) throw new RangeError(`negative ${account} posting`);
  return { account, direction, amountPaise };
};

const pair = (debit: LedgerAccount, credit: LedgerAccount, amountPaise: bigint): LedgerLine[] =>
  amountPaise === 0n
    ? []
    : [line(debit, 'DEBIT', amountPaise), line(credit, 'CREDIT', amountPaise)];

export function payoutAccruedEntries(grossPaise: bigint): LedgerLine[] {
  return pair('COGS_VENDOR', 'VENDOR_PAYABLE', grossPaise);
}

export function tdsWithheldEntries(tdsPaise: bigint): LedgerLine[] {
  return pair('VENDOR_PAYABLE', 'TDS_PAYABLE', tdsPaise);
}

export function payoutDeductionEntries(
  recognisedPaise: bigint,
  appliedPaise: bigint,
): LedgerLine[] {
  return [
    ...pair('VENDOR_RECOVERABLE', 'VENDOR_DEDUCTIONS', recognisedPaise),
    ...pair('VENDOR_PAYABLE', 'VENDOR_RECOVERABLE', appliedPaise),
  ];
}

export function payoutPaidEntries(netPaise: bigint): LedgerLine[] {
  return pair('VENDOR_PAYABLE', 'CASH_GATEWAY', netPaise);
}
