/**
 * What a photographer is owed for each way a shoot can end (ADR-0027 D5), pure. A delivered
 * booking pays in full (ADR-0026 D3); the three that never reach delivery pay by the rules below.
 * Bigint paise, basis points, one half-up rounding per payout. Every number is a named constant
 * here, so an owner ruling is a one-line change.
 */
import type { PayoutBasis } from '@clickco/contracts';
import { roundHalfUp } from '@clickco/utils';

const BPS = 10_000n;

/** payouts.basis (addendum 0017). */
export type { PayoutBasis };
export type UndeliveredBasis = Exclude<PayoutBasis, 'DELIVERED'>;

export interface OutcomeRule {
  /** The share of the full payout this outcome pays. */
  readonly shareBps: number;
  /** Whether the extension and waiting payout shares (ADR-0013 D8/D9) count toward it. */
  readonly includesExtras: boolean;
  /** Travel passes through at 100 % whatever the share (doc 05 step 12: the fuel was spent). */
  readonly travelPassThrough: boolean;
}

export const OUTCOME_PAYOUT_RULES: Readonly<Record<PayoutBasis, OutcomeRule>> = {
  DELIVERED: { shareBps: 10_000, includesExtras: true, travelPassThrough: true },
  /**
   * DOMAIN §2 (UPLOADING/PROCESSING/QA → DATA_LOSS) and v0.2 G-13: "full photographer payout".
   * Owner-overridable: G-13 names only a total loss; a partial loss pays the same here because it
   * cannot pay less than a complete one.
   */
  DATA_LOSS: { shareBps: 10_000, includesExtras: true, travelPassThrough: true },
  /**
   * T&C §7.2 / DOMAIN §2: 50 % of the booking value is charged. The photographer gets their share
   * of what is charged (doc 05 step 12): half the payout, travel still in full. Owner-overridable.
   */
  ACCESS_DENIED: { shareBps: 5_000, includesExtras: true, travelPassThrough: true },
  /**
   * T&C §3.8 / ADR-0013 D12: the booking is treated as completed, so the booked payout is owed.
   * The waiting charge is waived at the review (ADR-0016 D12), so its payout share is not.
   */
  CLIENT_ABSENT: { shareBps: 10_000, includesExtras: false, travelPassThrough: true },
};

/** DOMAIN §2 / G-13: full payout on data loss is capped at 2 incidents per photographer a year. */
export const DATA_LOSS_CAP = {
  incidents: 2,
  /** "A year": any 365 days, so a March + April pair cannot double the cap. */
  windowDays: 365,
} as const;

export interface JobPayout {
  /** The accepted offer (incentive included) or the quote's expected payout; travel included. */
  readonly basePaise: bigint;
  /** Extension and waiting payout shares. */
  readonly extrasPaise: bigint;
  /** The travel inside `basePaise` (the quote snapshot's travel amount). */
  readonly travelPaise: bigint;
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export function outcomeGross(
  basis: PayoutBasis,
  job: JobPayout,
): { readonly grossPaise: bigint; readonly shareBps: number } {
  if (job.basePaise < 0n || job.extrasPaise < 0n || job.travelPaise < 0n) {
    throw new RangeError('outcomeGross: negative payout');
  }
  const rule = OUTCOME_PAYOUT_RULES[basis];
  const full = job.basePaise + (rule.includesExtras ? job.extrasPaise : 0n);
  const travel = rule.travelPassThrough ? min(job.travelPaise, full) : 0n;
  const shared = roundHalfUp((full - travel) * BigInt(rule.shareBps), BPS);
  return { grossPaise: shared + travel, shareBps: rule.shareBps };
}

/** `earlier` data losses for this photographer in the window: from the third on, withheld. */
export const dataLossWithheld = (earlier: number): boolean => earlier >= DATA_LOSS_CAP.incidents;
