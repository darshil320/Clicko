import type { AdminReviewItem, ReviewOutcome } from '@clickco/contracts';
import { formatRupees } from '../../shared/money-labels';

/** What settling will do, in one sentence (ADR-0026 D8: the confirm spells out the consequence). */
export function consequence(
  item: Pick<AdminReviewItem, 'clientName'>,
  outcome: ReviewOutcome,
  amountPaise: number,
  creditPaise: number,
): string {
  const who = item.clientName ?? 'the client';
  const amount = formatRupees(amountPaise);
  const credit =
    creditPaise > 0
      ? ` A ${formatRupees(creditPaise)} credit is issued to ${who} now, valid for 12 months.`
      : '';
  switch (outcome) {
    case 'REFUND_REQUESTED':
      return `A refund of ${amount} to ${who} goes to the Refunds desk, where a second person approves it.${credit}`;
    case 'CREDIT_ISSUED':
      return `${who} gets a ${amount} credit now, valid for 12 months. An issued credit can't be withdrawn.`;
    case 'CHARGE_RAISED':
      return `${amount} is recorded as owed by ${who}. Nothing is charged automatically.`;
    case 'NO_ACTION':
      return 'This item is closed and no money moves.';
  }
}
