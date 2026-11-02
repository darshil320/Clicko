import {
  type AdminBookingMoney,
  type AdminBookingPayment,
  AdminIssueCreditBody,
  AdminRequestRefundBody,
  CREDIT_FOUR_EYES_PAISE,
  type CreditReason,
  MONEY_APPROVER_ROLES,
  type RefundReason,
  type RefundStatus,
  type StaffGrant,
} from '@clickco/contracts';
import { DESK_ROLES } from '../../shared/access';
import { formatRupees, parseRupees } from '../../shared/money-labels';
import { canAct } from '../../shared/use-can';

/**
 * The booking page's Refund and Issue credit actions (ADR-0026 D1/D2, ADR-0027 D6a), as pure
 * rules: who sees them, how much each may move, when a second person or a fresh authenticator
 * code is needed, and what the confirm dialog says. The API decides; this only hides and
 * explains what it would refuse. Amounts are integer paise.
 */

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId'>>;

export interface MoneyAccess {
  /** May ask for a refund on this booking (someone else approves it on the Refunds desk). */
  readonly refund: boolean;
  /** May issue a credit on this booking (the Quality Manager, finance, super admin). */
  readonly credit: boolean;
  /** Finance or super admin in the booking's city: no Quality Manager ceiling on credits. */
  readonly unlimited: boolean;
}

/** What this person may do with money on a booking in `cityId` (grants in that city only). */
export function moneyAccess(grants: Grants, cityId: string): MoneyAccess {
  return {
    refund: canAct(grants, DESK_ROLES.refunds, cityId),
    credit: canAct(grants, MONEY_APPROVER_ROLES, cityId),
    unlimited: canAct(grants, ['FINANCE'], cityId),
  };
}

/** Refunds the server counts against the ceilings: approved, at the gateway, or done. */
const COMMITTED: ReadonlyArray<RefundStatus> = ['APPROVED', 'PROCESSING', 'COMPLETED'];

export type MoneyFacts = Pick<
  AdminBookingMoney,
  'totalPaise' | 'refundablePaise' | 'creditedPaise' | 'qmLimitPaise' | 'clientName'
> & {
  readonly refunds: ReadonlyArray<
    Pick<AdminBookingMoney['refunds'][number], 'status' | 'amountPaise'>
  >;
  readonly payments: ReadonlyArray<
    Pick<AdminBookingPayment, 'id' | 'refundablePaise' | 'paidWith'>
  >;
};

/** Refunds approved or done plus credits issued on the booking (the ceilings count both). */
export function committedPaise(m: Pick<MoneyFacts, 'refunds' | 'creditedPaise'>): number {
  const refunded = m.refunds
    .filter((r) => COMMITTED.includes(r.status))
    .reduce((sum, r) => sum + r.amountPaise, 0);
  return refunded + m.creditedPaise;
}

/** Payments with something left to refund (a refund goes back against one payment). */
export function refundablePayments(m: Pick<MoneyFacts, 'payments'>) {
  return m.payments.filter((p) => p.refundablePaise > 0);
}

/** The most a refund request can be: the whole booking, or one payment when it is named. */
export function refundRoom(
  m: Pick<MoneyFacts, 'refundablePaise' | 'payments'>,
  paymentId?: string,
) {
  if (!paymentId) return m.refundablePaise;
  return m.payments.find((p) => p.id === paymentId)?.refundablePaise ?? 0;
}

/** Why the Refund button is off, or null when there is something to refund. */
export function refundBlocked(m: Pick<MoneyFacts, 'refundablePaise'>): string | null {
  return m.refundablePaise > 0
    ? null
    : 'Nothing can go back now: nothing was paid, or it is already refunded or on its way back.';
}

const ABOVE_ZERO = 'Enter an amount above ₹0';

/** The refund amount's problem in plain words (the server's REFUND_TOO_LARGE, said first). */
export function refundAmountProblem(
  m: Pick<MoneyFacts, 'refundablePaise' | 'payments'>,
  amountPaise: number | null,
  paymentId?: string,
): string | null {
  if (amountPaise === null || amountPaise <= 0) return ABOVE_ZERO;
  const room = refundRoom(m, paymentId);
  if (amountPaise <= room) return null;
  return room > 0
    ? `The most that can go back now is ${formatRupees(room)}`
    : 'Nothing on this payment can be refunded now';
}

/**
 * ADR-0027 D6a: approving a refund that takes the booking above the Quality Manager's ceiling is
 * finance's, with a fresh authenticator code.
 */
export function refundNeedsFinance(
  m: Pick<MoneyFacts, 'refunds' | 'creditedPaise' | 'qmLimitPaise'>,
  amountPaise: number,
): boolean {
  return committedPaise(m) + amountPaise > m.qmLimitPaise;
}

export interface CreditRoom {
  readonly maxPaise: number;
  /** What caps it: the booking total, or the Quality Manager's ceiling on this booking. */
  readonly limitedBy: 'TOTAL' | 'QM_LIMIT';
}

/**
 * The most a credit can be: refunds and credits never add up to more than the booking total;
 * a Quality Manager (without finance in the city) also stays within the ceiling.
 */
export function creditRoom(
  m: Pick<MoneyFacts, 'refunds' | 'creditedPaise' | 'qmLimitPaise' | 'totalPaise'>,
  unlimited: boolean,
): CreditRoom {
  const committed = committedPaise(m);
  const leftOfTotal = Math.max(0, m.totalPaise - committed);
  if (unlimited) return { maxPaise: leftOfTotal, limitedBy: 'TOTAL' };
  const leftOfLimit = Math.max(0, m.qmLimitPaise - committed);
  return leftOfLimit < leftOfTotal
    ? { maxPaise: leftOfLimit, limitedBy: 'QM_LIMIT' }
    : { maxPaise: leftOfTotal, limitedBy: 'TOTAL' };
}

/** Why the Issue credit button is off, or null when a credit can still be issued. */
export function creditBlocked(
  m: Pick<MoneyFacts, 'refunds' | 'creditedPaise' | 'qmLimitPaise' | 'totalPaise'>,
  unlimited: boolean,
): string | null {
  const room = creditRoom(m, unlimited);
  if (room.maxPaise > 0) return null;
  return room.limitedBy === 'TOTAL'
    ? 'Refunds and credits already add up to the booking total.'
    : `Your limit of ${formatRupees(m.qmLimitPaise)} on this booking is used up. Finance can issue more.`;
}

export function creditAmountProblem(
  m: Pick<MoneyFacts, 'refunds' | 'creditedPaise' | 'qmLimitPaise' | 'totalPaise'>,
  unlimited: boolean,
  amountPaise: number | null,
): string | null {
  if (amountPaise === null || amountPaise <= 0) return ABOVE_ZERO;
  const room = creditRoom(m, unlimited);
  if (amountPaise <= room.maxPaise) return null;
  return room.limitedBy === 'TOTAL'
    ? `Refunds and credits can't come to more than the booking total: at most ${formatRupees(room.maxPaise)} more.`
    : `Above your limit on this booking: at most ${formatRupees(room.maxPaise)}. Finance can issue more.`;
}

/** Audit L8: a credit above ₹5,000 needs the issuer's code and a second finance person's. */
export function creditNeedsFourEyes(amountPaise: number): boolean {
  return amountPaise > CREDIT_FOUR_EYES_PAISE;
}

// ── Request bodies (validated with the same contract the API uses) ──────────

export function refundBody(f: {
  readonly amount: string;
  readonly reason: RefundReason;
  readonly note: string;
  readonly paymentId: string | null;
}) {
  return AdminRequestRefundBody.safeParse({
    amountPaise: parseRupees(f.amount) ?? -1,
    reason: f.reason,
    note: f.note,
    ...(f.paymentId ? { paymentId: f.paymentId } : {}),
  });
}

export interface FourEyesInput {
  readonly code: string;
  readonly coEmail: string;
  readonly coCode: string;
}

/** Above the four-eyes line both codes and the co-approver's email are sent, so none is left out. */
export function creditBody(f: {
  readonly amount: string;
  readonly reason: CreditReason;
  readonly note: string;
  readonly approval: FourEyesInput;
}) {
  const amountPaise = parseRupees(f.amount) ?? -1;
  const approval = creditNeedsFourEyes(amountPaise)
    ? {
        code: f.approval.code,
        coApprover: { email: f.approval.coEmail, code: f.approval.coCode },
      }
    : {};
  return AdminIssueCreditBody.safeParse({
    amountPaise,
    reason: f.reason,
    note: f.note,
    ...approval,
  });
}

// ── What the confirm dialogs say (ADR-0026 D8) ──────────────────────────────

/** "₹2,500 goes back to Priya Sharma (Card ending 4242) once someone else approves it …" */
export function refundConsequence(
  m: Pick<MoneyFacts, 'clientName' | 'refunds' | 'creditedPaise' | 'qmLimitPaise'>,
  amountPaise: number,
  payment: Pick<AdminBookingPayment, 'paidWith'> | null,
): string {
  const to = payment ? `${m.clientName} (${payment.paidWith})` : m.clientName;
  const how = payment ? '' : ', newest payment first,';
  const finance = refundNeedsFinance(m, amountPaise)
    ? ` It is above the Quality Manager's limit of ${formatRupees(m.qmLimitPaise)} on this booking, so finance approves it with a fresh authenticator code.`
    : '';
  return `${formatRupees(amountPaise)} goes back to ${to}${how} once someone else approves it on the Refunds desk. You can't approve your own request.${finance}`;
}

/** "Priya Sharma gets a ₹500 credit now, valid for 12 months …" */
export function creditConsequence(m: Pick<MoneyFacts, 'clientName'>, amountPaise: number): string {
  const four = creditNeedsFourEyes(amountPaise)
    ? ` It is above ${formatRupees(CREDIT_FOUR_EYES_PAISE)}, so your code and a second finance person's code confirm it together.`
    : '';
  return `${m.clientName} gets a ${formatRupees(amountPaise)} credit now, valid for 12 months on a future booking. An issued credit can't be withdrawn.${four}`;
}
