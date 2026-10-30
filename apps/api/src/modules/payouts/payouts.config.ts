/**
 * Every payout number in one place (ADR-0026 D3). A CA ruling (194J instead of 194C, a new rate,
 * a new threshold) is a change here, not in code. Money is bigint paise, rates basis points.
 */

export interface TdsRules {
  /** Stored on every payout row (`payouts.tds_section`). */
  readonly section: string;
  /** Individuals and HUFs (PAN 4th character P or H). */
  readonly individualRateBps: number;
  /** Firms, companies, AOPs, trusts … every other PAN holder. */
  readonly otherRateBps: number;
  /** s.206AA: no valid PAN on file. */
  readonly noPanRateBps: number;
  /** No TDS while a single payment is at or under this … */
  readonly singlePaymentLimitPaise: bigint;
  /** … and the financial year's total is at or under this. */
  readonly yearlyLimitPaise: bigint;
  /** TDS is rounded half-up to this unit (100 = the nearest rupee). */
  readonly roundToPaise: bigint;
  /** PAN 4th character for the individual / HUF rate. */
  readonly individualPanTypes: readonly string[];
}

/** s.194C (Clickco is the principal; the photographer works for it under the vendor agreement). */
export const TDS_RULES: TdsRules = {
  section: '194C',
  individualRateBps: 100,
  otherRateBps: 200,
  noPanRateBps: 2_000,
  singlePaymentLimitPaise: 3_000_000n, // ₹30,000
  yearlyLimitPaise: 10_000_000n, // ₹1,00,000
  roundToPaise: 100n,
  individualPanTypes: ['P', 'H'],
};

export const PAYOUT_CONFIG = {
  /** v0.2 G-23: a payout falls due 3 days after delivery. */
  daysAfterDelivery: 3,
  /** "Coming up" on the Due tab. */
  upcomingDays: 7,
  /** Photographers listed on the Due tab in one answer (the totals count everyone). */
  maxDuePayees: 500,
  /** Bank transfers in one batch (the reference has three digits). */
  maxTransfersPerBatch: 999,
  /** A late-delivery or penalty deduction is looked for on payouts this recent. */
  deductionLookbackDays: 180,
  /** Bank file. */
  bankFile: {
    paymentType: 'NEFT',
    /** Most Indian bank bulk-upload formats cap the beneficiary name at 35 characters. */
    beneficiaryNameMax: 35,
    narrationPrefix: 'Clickco payout',
  },
  /** TDS deposit: the 7th of the next month; March's by 30 April (Rule 30). */
  tdsDepositDay: 7,
  tdsMarchDepositDay: 30,
} as const;

/** Every payout is settled through a bank file until RazorpayX keys exist. */
export const BANK_FILE_PROVIDER = 'BANK_FILE';
