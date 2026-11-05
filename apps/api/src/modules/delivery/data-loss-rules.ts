/**
 * ADR-0030 D2 — the money of a lost shoot, pure. Bigint paise, basis points, one half-up rounding
 * per amount (DOMAIN §5 rules 1, 2, 5).
 */
import { roundHalfUp } from '@clickco/utils';

const BPS = 10_000n;

export interface PaymentFacts {
  readonly capturedPaise: bigint;
  readonly refundedPaise: bigint;
  /** Refunds on this payment already approved or at the gateway (APPROVED + PROCESSING). */
  readonly committedPaise: bigint;
}

/**
 * Complete loss, T&C §5.5 "a full refund of all amounts paid": what each payment captured, less
 * what already went back or is approved and on its way. A refund merely asked for (REQUESTED) or
 * one that FAILED does not reduce it: the loss supersedes those.
 */
export function completeLossRefund(payments: readonly PaymentFacts[]): bigint {
  return payments.reduce((sum, p) => {
    const left = p.capturedPaise - p.refundedPaise - p.committedPaise;
    return sum + (left > 0n ? left : 0n);
  }, 0n);
}

/** Partial loss: the affected share of the whole booking total (every snapshot sequence). */
export function partialLossShare(totalPaise: bigint, affectedBps: number): bigint {
  if (!Number.isInteger(affectedBps) || affectedBps <= 0 || affectedBps >= Number(BPS)) {
    throw new RangeError(`partialLossShare: ${affectedBps} bps is not a partial loss`);
  }
  if (totalPaise < 0n) throw new RangeError('partialLossShare: negative total');
  return roundHalfUp(totalPaise * BigInt(affectedBps), BPS);
}

/** The share, split into what can go back now and what waits for the balance to be paid. */
export function splitPartialRefund(
  owedPaise: bigint,
  refundableNowPaise: bigint,
): { readonly nowPaise: bigint; readonly laterPaise: bigint } {
  const nowPaise = owedPaise < refundableNowPaise ? owedPaise : refundableNowPaise;
  const safeNow = nowPaise > 0n ? nowPaise : 0n;
  return { nowPaise: safeNow, laterPaise: owedPaise - safeNow };
}
