import {
  type AdminBookingMoney,
  AdminConfirmDataLossBody,
  AdminConfirmPartialLossBody,
  type BookingStatus,
  DATA_LOSS_CONFIRM_ROLES,
  DATA_LOSS_FROM_STATUSES,
  type StaffGrant,
} from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';
import { formatRupees } from '../../shared/money-labels';
import { canAct } from '../../shared/use-can';
import { type MoneyFacts as RefundFacts, refundNeedsFinance } from './money-actions';

/**
 * The booking page's "Files lost" actions (ADR-0030 D2), as pure rules: who sees them, when, the
 * amounts, the request bodies, and what the confirm dialog says. The API decides; this only
 * hides and explains. Amounts are integer paise.
 */

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId'>>;

/** The Quality Manager or the city manager of the booking's city (SUPER_ADMIN anywhere). */
export function dataLossAccess(grants: Grants, cityId: string): boolean {
  return canAct(grants, DATA_LOSS_CONFIRM_ROLES, cityId);
}

/** Files were taken but not delivered: uploading, processing or in QA (DOMAIN §2). */
export function dataLossOpen(status: BookingStatus): boolean {
  return DATA_LOSS_FROM_STATUSES.includes(status);
}

type MoneyFacts = Pick<AdminBookingMoney, 'refundablePaise' | 'totalPaise'> & {
  readonly refunds: ReadonlyArray<
    Pick<AdminBookingMoney['refunds'][number], 'status' | 'amountPaise'>
  >;
};

/**
 * A complete loss gives back everything paid that has not already gone back or been approved:
 * what can still be refunded, plus refunds only asked for (the loss replaces them). A failed one
 * is not in flight, so it is already inside what can be refunded.
 */
export function completeLossRefundPaise(
  m: Pick<MoneyFacts, 'refundablePaise' | 'refunds'>,
): number {
  const waiting = m.refunds
    .filter((r) => r.status === 'REQUESTED')
    .reduce((sum, r) => sum + r.amountPaise, 0);
  return m.refundablePaise + waiting;
}

export interface PartialSplit {
  readonly owedPaise: number;
  readonly nowPaise: number;
  readonly laterPaise: number;
}

/** The affected share of the booking total (rounded once, half up), now and after the balance. */
export function partialLossSplit(
  m: Pick<MoneyFacts, 'totalPaise' | 'refundablePaise'>,
  bps: number,
): PartialSplit {
  const owed = Number(roundHalfUp(BigInt(m.totalPaise) * BigInt(bps), 10_000n));
  const now = Math.max(0, Math.min(owed, m.refundablePaise));
  return { owedPaise: owed, nowPaise: now, laterPaise: owed - now };
}

/** "30" / "12.5%" → basis points (3000 / 1250); null unless strictly between 0 and 100. */
export function parsePercentBps(text: string): number | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(text.replace(/[%\s]/g, ''));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps > 0 && bps < 10_000 ? bps : null;
}

/**
 * Rule refunds skip the refund desk's ceiling, so the confirmation carries it: above the Quality
 * Manager's limit (refunds and credits already committed count) the second person must be finance
 * or a super admin. null when nothing needs saying.
 */
export function secondPersonRule(
  m: Pick<RefundFacts, 'refunds' | 'creditedPaise' | 'qmLimitPaise'>,
  refundPaise: number,
): string | null {
  if (refundPaise <= 0 || !refundNeedsFinance(m, refundPaise)) return null;
  return `This is above the Quality Manager's limit of ${formatRupees(m.qmLimitPaise)} on this booking, so the second person must be finance or a super admin.`;
}

export interface FourEyesInput {
  readonly code: string;
  readonly coEmail: string;
  readonly coCode: string;
}

const fourEyes = (f: FourEyesInput) => ({
  code: f.code,
  coApprover: { email: f.coEmail, code: f.coCode },
});

export function dataLossBody(f: FourEyesInput & { readonly note: string }) {
  return AdminConfirmDataLossBody.safeParse({ note: f.note, ...fourEyes(f) });
}

export function partialLossBody(
  f: FourEyesInput & { readonly note: string; readonly percent: string },
) {
  return AdminConfirmPartialLossBody.safeParse({
    affectedProportionBps: parsePercentBps(f.percent) ?? -1,
    note: f.note,
    ...fourEyes(f),
  });
}

const PAYOUT = 'is paid in full; a third loss in a year holds the payout for finance.';

/** "CLK-1004 ends here and nothing is delivered. ₹4,250 … Asha Patel is paid in full …" */
export function dataLossConsequence(f: {
  readonly reference: string;
  readonly clientName: string;
  readonly photographerName: string | null;
  readonly refundPaise: number;
}): string {
  const refund =
    f.refundPaise > 0
      ? `${formatRupees(f.refundPaise)}, everything ${f.clientName} paid that has not already gone back, goes back to them now by the data-loss rule; refunds still waiting for approval are replaced.`
      : `Nothing ${f.clientName} paid is left to refund.`;
  return `${f.reference} ends here and nothing is delivered. ${refund} ${f.photographerName ?? 'The photographer'} ${PAYOUT}`;
}

const percent = (bps: number): string =>
  `${bps % 100 === 0 ? bps / 100 : (bps / 100).toFixed(2).replace(/0$/, '')}%`;

/** "CLK-1004 carries on … 70% of the booking is ₹8,074.15: ₹5,767.25 goes back now …" */
export function partialLossConsequence(f: {
  readonly reference: string;
  readonly clientName: string;
  readonly bps: number;
  readonly split: PartialSplit;
}): string {
  const later =
    f.split.laterPaise > 0
      ? `, and ${formatRupees(f.split.laterPaise)} waits on the "To settle" desk until the balance is paid`
      : '';
  return `${f.reference} carries on and what survived is delivered. ${percent(f.bps)} of the booking is ${formatRupees(f.split.owedPaise)}: ${formatRupees(f.split.nowPaise)} goes back to ${f.clientName} now by the data-loss rule${later}.`;
}
