import { describe, expect, it } from 'vitest';
import { completeLossRefund, partialLossShare, splitPartialRefund } from '../data-loss-rules';

describe('complete loss: everything paid goes back (T&C §5.5, ADR-0030 D2)', () => {
  it('captured − refunded − what is already approved or at the gateway, per payment', () => {
    expect(
      completeLossRefund([
        { capturedPaise: 425_000n, refundedPaise: 0n, committedPaise: 0n },
        { capturedPaise: 50_000n, refundedPaise: 10_000n, committedPaise: 5_000n },
      ]),
    ).toBe(460_000n);
  });

  it('never below zero for a payment already fully on its way back', () => {
    expect(
      completeLossRefund([{ capturedPaise: 100n, refundedPaise: 60n, committedPaise: 60n }]),
    ).toBe(0n);
  });
});

describe('partial loss: the affected share of the booking (T&C §5.5)', () => {
  it('rounds once, half up, on the whole booking total', () => {
    expect(partialLossShare(850_000n, 3_000)).toBe(255_000n);
    // 1,153,450 × 33.33 % = 384,444.885 → 384,445
    expect(partialLossShare(1_153_450n, 3_333)).toBe(384_445n);
    // exactly half a paisa rounds up
    expect(partialLossShare(1n, 5_000)).toBe(1n);
  });

  it('refuses a proportion that is not strictly between none and all', () => {
    expect(() => partialLossShare(100n, 0)).toThrow(RangeError);
    expect(() => partialLossShare(100n, 10_000)).toThrow(RangeError);
    expect(() => partialLossShare(100n, 12.5)).toThrow(RangeError);
  });

  it('refunds what it can now and leaves the rest for after the balance', () => {
    expect(splitPartialRefund(255_000n, 425_000n)).toEqual({ nowPaise: 255_000n, laterPaise: 0n });
    expect(splitPartialRefund(600_000n, 425_000n)).toEqual({
      nowPaise: 425_000n,
      laterPaise: 175_000n,
    });
    expect(splitPartialRefund(100n, 0n)).toEqual({ nowPaise: 0n, laterPaise: 100n });
  });
});
