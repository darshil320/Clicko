/**
 * Photographer payout arithmetic on a frozen snapshot (doc 05 step 12: payout =
 * round(share × (base + addons)) + travel). Pure, bigint paise, bps.
 */
import { roundHalfUp } from '@clickco/utils';
import { BPS_SCALE } from './constants';

/** v0.2 §9: a no-show re-broadcast pays 2.0× — on the base-service share only (ADR-0012 D5). */
export const NO_SHOW_INCENTIVE_BPS = 20_000;

/** The snapshot facts the split needs (booking_price_snapshots sequence 1). */
export interface PayoutSnapshot {
  readonly baseAmountPaise: bigint;
  readonly travelAmountPaise: bigint;
  readonly payoutShareBps: number;
  readonly expectedPayoutPaise: bigint;
}

export interface PayoutSplit {
  readonly baseSharePaise: bigint;
  /** Whatever the snapshot's single rounding left over: base + add-on shares reproduce it exactly. */
  readonly addonSharePaise: bigint;
  readonly travelPaise: bigint;
}

export function payoutSplit(s: PayoutSnapshot): PayoutSplit {
  const baseSharePaise = roundHalfUp(s.baseAmountPaise * BigInt(s.payoutShareBps), BPS_SCALE);
  const addonSharePaise = s.expectedPayoutPaise - s.travelAmountPaise - baseSharePaise;
  if (addonSharePaise < 0n) {
    throw new RangeError('payoutSplit: snapshot payout is inconsistent with its base and travel');
  }
  return { baseSharePaise, addonSharePaise, travelPaise: s.travelAmountPaise };
}

/** incentive = round(baseShare × incentive) + addonShare + travel (one rounding, half-up). */
export function noShowIncentivePayout(
  s: PayoutSnapshot,
  incentiveBps: number = NO_SHOW_INCENTIVE_BPS,
): bigint {
  const split = payoutSplit(s);
  return (
    roundHalfUp(split.baseSharePaise * BigInt(incentiveBps), BPS_SCALE) +
    split.addonSharePaise +
    split.travelPaise
  );
}
