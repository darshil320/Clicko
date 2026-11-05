import type { EarningsJob, ProPaidTransfer, ProPayoutStatus } from '@clickco/contracts';
import { formatDayMonth, istParts } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

/**
 * Where the photographer's money stands (ADR-0027 D5): each job's payout status in words, and
 * the bank transfers already paid with their TDS (s.194C, ADR-0026 D3). Pure, so it is tested.
 */

const PAYOUT_STATUS: Readonly<Record<ProPayoutStatus, string>> = {
  DUE: 'In the next weekly batch',
  IN_PAYMENT: 'On its way to your bank',
  PAID: 'Paid',
  WITHHELD: 'On hold. Support can tell you why.',
};

/** Before the shoot's outcome accrues a payout (e.g. the photos are not delivered yet). */
const NOT_YET_PAYABLE = 'Payable once the photos are delivered';

/** "Payout: On its way to your bank" */
export function payoutLine(job: EarningsJob): string {
  return `Payout: ${job.payoutStatus ? PAYOUT_STATUS[job.payoutStatus] : NOT_YET_PAYABLE}`;
}

export interface TransferRow {
  readonly key: string;
  /** "Paid 14 Dec" */
  readonly title: string;
  /** "3 shoots · TDS ₹126", then the UTR on its own line to match a bank statement. */
  readonly detail: string;
  /** What reached the bank. */
  readonly net: string;
  readonly accessibilityLabel: string;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One paid transfer: its date, net amount, TDS, any deductions, and the UTR's last 4. */
export function transferRow(transfer: ProPaidTransfer): TransferRow {
  const paid = new Date(transfer.paidAt);
  const day = formatDayMonth(paid);
  const amounts = [
    plural(transfer.payoutCount, 'shoot'),
    `TDS ${rupees(transfer.tdsPaise)}`,
    ...(transfer.deductionsPaise > 0 ? [`${rupees(transfer.deductionsPaise)} deducted`] : []),
  ];
  const bank = transfer.utrLast4 ? `UTR ending ${transfer.utrLast4}` : 'Nothing sent to the bank';
  const net = rupees(transfer.netPaise);
  return {
    key: transfer.batchReference,
    title: `Paid ${day}`,
    detail: `${amounts.join(' · ')}\n${bank}`,
    net,
    accessibilityLabel: `Paid ${day} ${istParts(paid).year}: ${net} after ${amounts.join(', ')}. ${bank}`,
  };
}

/** The Paid section appears once something has been paid. */
export const hasPaidTransfers = (transfers: readonly ProPaidTransfer[] | undefined): boolean =>
  (transfers?.length ?? 0) > 0;

/** The newest few first; "Show all" reveals the rest (the API sends at most 20). */
export const TRANSFERS_SHOWN = 3;

export function visibleTransfers(
  transfers: readonly ProPaidTransfer[],
  expanded: boolean,
  limit = TRANSFERS_SHOWN,
): readonly ProPaidTransfer[] {
  return expanded ? transfers : transfers.slice(0, limit);
}
