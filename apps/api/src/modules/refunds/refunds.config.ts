import { CREDIT_FOUR_EYES_PAISE } from '@clickco/contracts';

/**
 * ADR-0026 D1/D2 numbers in one place (ADR-0005 OD-12 for the Quality Manager ceiling). A CA or
 * owner ruling changes these constants, not the code.
 */
export const MONEY_DESK_CONFIG = {
  /** The QM approves refunds and issues credits up to the lower of ₹5,000 … */
  qmCeilingPaise: 500_000n,
  /** … or 50 % of the booking total (rounded down, so the ceiling never exceeds half). */
  qmCeilingBps: 5_000n,
  /**
   * Audit L8: a credit above this is four-eyes (the issuer's authenticator code plus a second
   * finance person's). ₹5,000 — the same figure as the QM ceiling, so only finance-sized credits.
   */
  creditFourEyesPaise: BigInt(CREDIT_FOUR_EYES_PAISE),
  /** A client credit is valid this many months, to the end of that IST day. */
  creditValidityMonths: 12,
  /** T&C §3.6(c): a photographer no-show with no replacement adds a ₹500 service credit. */
  noShowCreditPaise: 50_000n,
  /** T&C §7.2: a denied venue is chargeable at 50 % of the booking value. */
  accessDeniedChargeBps: 5_000n,
  /** T&C §3.6(b): a late replacement earns 25 % of the booking value as a credit. */
  lateReplacementCreditBps: 2_500n,
  /** A refund's gateway work holds this lease: three 10 s calls plus the database, with slack. */
  executionLeaseMs: 120_000,
  /**
   * A refund still PROCESSING with nothing found at the gateway is only re-sent after this long
   * (a timed-out send shows up in the gateway's list well within it). Before that, "check again"
   * only looks — it never creates a second refund (security review H1).
   */
  resendAfterMs: 15 * 60_000,
} as const;

/** schema `refunds.reason_code`, plus UNFILLED and PAYMENT_ANOMALY (ADR-0026 D1 review items). */
export const REFUND_REASONS = [
  'CLIENT_CANCEL',
  'PRO_NO_SHOW',
  'UNFILLED',
  'EMERGENCY_UNFILLED',
  'SLA_BREACH',
  'DATA_LOSS',
  'QUALITY',
  'ACCESS_DENIED',
  'PAYMENT_ANOMALY',
  'GOODWILL',
] as const;
export type RefundReasonCode = (typeof REFUND_REASONS)[number];

/** `client_credits.reason_code` (schema comment: SLA remedies, goodwill, the no-show apology). */
export const CREDIT_REASONS = [
  'SLA_BREACH',
  'LATE_REPLACEMENT',
  'PRO_NO_SHOW',
  'QUALITY',
  'GOODWILL',
] as const;
export type CreditReasonCode = (typeof CREDIT_REASONS)[number];
