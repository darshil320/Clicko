/**
 * ADR-0026 D1/D2 decisions as pure functions: who may approve a refund or issue a credit, and
 * how a refund spreads over a booking's payments. Bigint paise only.
 */
import type { StaffRole } from '@clickco/contracts';
import { formatINR } from '@clickco/utils';
import { MONEY_DESK_CONFIG } from './refunds.config';

export type Check =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'FOUR_EYES' | 'ABOVE_LIMIT' | 'NOT_AN_APPROVER';
      readonly message: string;
      readonly limitPaise?: bigint;
    };

const UNLIMITED: readonly StaffRole[] = ['SUPER_ADMIN', 'FINANCE'];
const OK: Check = { ok: true };

/** "₹5,000", or "₹4,227.05" when there are paise: amounts in staff-facing messages. */
export const rupees = (paise: bigint): string =>
  formatINR(paise, { showPaise: paise % 100n !== 0n });

/** The lower of ₹5,000 or 50 % of the booking total (rounded down). */
export function qmCeilingPaise(bookingTotalPaise: bigint): bigint {
  const half = (bookingTotalPaise * MONEY_DESK_CONFIG.qmCeilingBps) / 10_000n;
  return half < MONEY_DESK_CONFIG.qmCeilingPaise ? half : MONEY_DESK_CONFIG.qmCeilingPaise;
}

export interface LimitInput {
  /** The caller's roles that cover the booking's city. */
  readonly roles: readonly StaffRole[];
  readonly amountPaise: bigint;
  readonly bookingTotalPaise: bigint;
  /** Refunds already approved (not failed or rejected) and credits already issued on the booking. */
  readonly committedPaise: bigint;
}

function withinLimit(i: LimitInput, what: string): Check {
  if (i.roles.some((r) => UNLIMITED.includes(r))) return OK;
  if (!i.roles.includes('QUALITY_MANAGER')) {
    return {
      ok: false,
      code: 'NOT_AN_APPROVER',
      message: `Only the Quality Manager or finance can ${what}`,
    };
  }
  const limitPaise = qmCeilingPaise(i.bookingTotalPaise);
  if (i.committedPaise + i.amountPaise <= limitPaise) return OK;
  return {
    ok: false,
    code: 'ABOVE_LIMIT',
    limitPaise,
    message: `This is above your limit of ${rupees(limitPaise)} for this booking. Finance needs to ${what}.`,
  };
}

/** Maker–checker: never the requester; the QM within the ceiling; finance any amount. */
export function approvalCheck(
  i: LimitInput & { readonly approverId: string; readonly requesterId: string | null },
): Check {
  if (i.requesterId !== null && i.approverId === i.requesterId) {
    return {
      ok: false,
      code: 'FOUR_EYES',
      message: 'You asked for this refund, so someone else has to approve it.',
    };
  }
  return withinLimit(i, 'approve it');
}

/**
 * Audit: approving this refund takes the booking above the Quality Manager's ceiling (only
 * finance can), so the approver also enters a fresh authenticator code.
 */
export function refundNeedsStepUp(i: {
  readonly amountPaise: bigint;
  readonly bookingTotalPaise: bigint;
  readonly committedPaise: bigint;
}): boolean {
  return i.committedPaise + i.amountPaise > qmCeilingPaise(i.bookingTotalPaise);
}

/** Audit L8: a credit above MONEY_DESK_CONFIG.creditFourEyesPaise needs a second approver. */
export function creditNeedsFourEyes(amountPaise: bigint): boolean {
  return amountPaise > MONEY_DESK_CONFIG.creditFourEyesPaise;
}

/** Credits: the QM within the ceiling, finance any amount (no four-eyes: nothing leaves the bank). */
export function creditCheck(i: LimitInput): Check {
  return withinLimit(i, 'issue it');
}

export interface RefundTargetFacts {
  readonly paymentId: string;
  /** captured − refunded − refunds still in flight on this payment. */
  readonly refundablePaise: bigint;
  readonly at: Date;
}

export type Allocation =
  | { readonly ok: true; readonly parts: ReadonlyArray<{ paymentId: string; amountPaise: bigint }> }
  | { readonly ok: false; readonly maxPaise: bigint };

/**
 * A gateway refund goes back against one payment, so a refund is one row per payment: newest
 * payment first (the balance before the advance), or only `paymentId` when one is named.
 */
export function allocateRefund(
  amountPaise: bigint,
  targets: readonly RefundTargetFacts[],
  paymentId?: string,
): Allocation {
  const usable = targets
    .filter((t) => t.refundablePaise > 0n && (paymentId === undefined || t.paymentId === paymentId))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const maxPaise = usable.reduce((sum, t) => sum + t.refundablePaise, 0n);
  if (amountPaise <= 0n || amountPaise > maxPaise) return { ok: false, maxPaise };
  const parts: { paymentId: string; amountPaise: bigint }[] = [];
  let left = amountPaise;
  for (const t of usable) {
    if (left === 0n) break;
    const take = t.refundablePaise < left ? t.refundablePaise : left;
    parts.push({ paymentId: t.paymentId, amountPaise: take });
    left -= take;
  }
  return { ok: true, parts };
}

const IST_OFFSET_MS = 330 * 60_000;

/** 12 months from the IST issue date, to 23:59:59.999 IST; 29 Feb falls back to 28 Feb. */
export function creditExpiresAt(issuedAt: Date): Date {
  const ist = new Date(issuedAt.getTime() + IST_OFFSET_MS);
  const months = ist.getUTCMonth() + MONEY_DESK_CONFIG.creditValidityMonths;
  const year = ist.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(ist.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
}
