import type { CreditReason, RefundReason, RefundStatus, ReviewOutcome } from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';
import { formatMoney } from './format';

/** Plain words for the money desks (ADR-0026 D8: no raw codes on screen). */

export const REFUND_REASON_LABEL: Readonly<Record<RefundReason, string>> = {
  CLIENT_CANCEL: 'Client cancelled',
  PRO_NO_SHOW: 'Photographer did not show up',
  UNFILLED: 'No photographer found',
  EMERGENCY_UNFILLED: 'Emergency booking not filled',
  SLA_BREACH: 'Photos delivered late',
  DATA_LOSS: 'Photos lost',
  QUALITY: 'Quality complaint',
  ACCESS_DENIED: 'Venue access denied',
  PAYMENT_ANOMALY: 'Charged by mistake',
  GOODWILL: 'Goodwill',
};

export const CREDIT_REASON_LABEL: Readonly<Record<CreditReason, string>> = {
  SLA_BREACH: 'Photos delivered late',
  LATE_REPLACEMENT: 'Replacement arrived late',
  PRO_NO_SHOW: 'Photographer did not show up',
  QUALITY: 'Quality complaint',
  GOODWILL: 'Goodwill',
};

export const REFUND_STATUS: Readonly<Record<RefundStatus, { label: string; tone: BadgeVariant }>> =
  {
    REQUESTED: { label: 'Waiting for approval', tone: 'warning' },
    APPROVED: { label: 'Approved', tone: 'neutral' },
    PROCESSING: { label: 'Sending to bank', tone: 'neutral' },
    COMPLETED: { label: 'Refunded', tone: 'success' },
    FAILED: { label: 'Failed — try again', tone: 'destructive' },
    REJECTED: { label: 'Rejected', tone: 'outline' },
  };

export const OUTCOME_LABEL: Readonly<Record<ReviewOutcome, string>> = {
  REFUND_REQUESTED: 'Refund',
  CREDIT_ISSUED: 'Credit',
  CHARGE_RAISED: 'Charge the client',
  NO_ACTION: 'No action',
};

/**
 * "2,500" / "₹2,500.50" / "2500.5" → paise (250000 / 250050 / 250050); null when it is not an
 * amount of rupees with at most two decimals.
 */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!m) return null;
  const paise = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(paise) ? paise : null;
}

/** 250050 → "2500.50", 250000 → "2500" (an input's starting value). */
export function rupeesInput(paise: number): string {
  const r = Math.trunc(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, '0')}`;
}

/** "₹2,500" for whole rupees, "₹8,454.11" when there are paise. */
export function formatRupees(paise: number): string {
  return formatMoney(paise, paise % 100 !== 0);
}
