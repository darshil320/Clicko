import type {
  ClientBookingCredit,
  ClientBookingMoney,
  ClientBookingRefund,
  CreditReason,
} from '@clickco/contracts';
import { formatDayMonth, istParts } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

/**
 * The "Refunds & credits" section of a booking (ADR-0027 D5): one plain row per refund and per
 * credit, oldest first as the API sends them. Pure, so the wording is tested.
 */

/** "settled" rows are finished (refunded, credit used up or expired) and read calmer. */
export type MoneyRowState = 'moving' | 'settled';

export interface MoneyRow {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly amount: string;
  readonly state: MoneyRowState;
}

/** T&C §3.9: refunds reach the original payment method within 7–10 business days. */
const REFUND_TRAVEL = 'It reaches your original payment method within 7–10 business days.';

const CREDIT_REASON: Readonly<Record<CreditReason, string>> = {
  SLA_BREACH: 'for the late delivery',
  LATE_REPLACEMENT: 'for the late replacement photographer',
  PRO_NO_SHOW: "for the photographer who didn't show up",
  QUALITY: 'for the photo quality',
  GOODWILL: 'a thank-you from us',
};

const NBSP = '\u00a0';
const day = (iso: string): string => formatDayMonth(new Date(iso));
/** Expiry is a year out: "2 Nov 2027", so it can't be read as this year; never split across lines. */
const dayWithYear = (iso: string): string =>
  `${day(iso)} ${istParts(new Date(iso)).year}`.replace(/ /g, NBSP);

export function refundRow(refund: ClientBookingRefund): MoneyRow {
  const amount = rupees(refund.amountPaise);
  if (refund.status === 'REFUNDED') {
    return {
      key: `refund-${refund.id}`,
      title: 'Refunded',
      detail: `Back on your original payment method · ${day(refund.completedAt ?? refund.initiatedAt)}`,
      amount,
      state: 'settled',
    };
  }
  return {
    key: `refund-${refund.id}`,
    title: 'Refund on its way',
    detail: `Sent ${day(refund.initiatedAt)}. ${REFUND_TRAVEL}`,
    amount,
    state: 'moving',
  };
}

export function creditRow(credit: ClientBookingCredit): MoneyRow {
  const base = {
    key: `credit-${credit.id}`,
    title: `Clickco credit, ${CREDIT_REASON[credit.reason]}`,
    amount: rupees(credit.amountPaise),
  };
  if (credit.expired) {
    return { ...base, detail: `Expired ${dayWithYear(credit.expiresAt)}`, state: 'settled' };
  }
  if (credit.remainingPaise <= 0) {
    return { ...base, detail: 'Used on a later booking', state: 'settled' };
  }
  const left =
    credit.remainingPaise === credit.amountPaise
      ? 'Use it on your next booking'
      : `${rupees(credit.remainingPaise)} left to use`;
  return {
    ...base,
    detail: `${left} · valid until ${dayWithYear(credit.expiresAt)}`,
    state: 'moving',
  };
}

/** Refunds first, then credits. Empty when there is nothing to show (the section hides). */
export function moneyRows(money: ClientBookingMoney): readonly MoneyRow[] {
  return [...money.refunds.map(refundRow), ...money.credits.map(creditRow)];
}

export const hasMoneyToShow = (money: ClientBookingMoney): boolean =>
  money.refunds.length > 0 || money.credits.length > 0;
