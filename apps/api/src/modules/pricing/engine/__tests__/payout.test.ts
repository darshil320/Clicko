import { describe, expect, it } from 'vitest';
import { NO_SHOW_INCENTIVE_BPS, noShowIncentivePayout, payoutSplit } from '../payout';

describe('no-show re-broadcast incentive (ADR-0012 D5: 2.0× on the base-service share only)', () => {
  it('doubles the base share and leaves the add-on share and travel as they were', () => {
    // base 500000 + addons 100000 at 60% → 360000; + travel 20000 = 380000.
    const snapshot = {
      baseAmountPaise: 500_000n,
      travelAmountPaise: 20_000n,
      payoutShareBps: 6000,
      expectedPayoutPaise: 380_000n,
    };
    expect(payoutSplit(snapshot)).toEqual({
      baseSharePaise: 300_000n,
      addonSharePaise: 60_000n,
      travelPaise: 20_000n,
    });
    expect(NO_SHOW_INCENTIVE_BPS).toBe(20_000);
    expect(noShowIncentivePayout(snapshot)).toBe(680_000n);
  });

  it('rounds the base share half-up once, and the add-on share absorbs the remainder exactly', () => {
    // (333333 + 100001) × 55% = 238333.7 → 238334; base share 333333 × 55% = 183333.15 → 183333.
    const snapshot = {
      baseAmountPaise: 333_333n,
      travelAmountPaise: 0n,
      payoutShareBps: 5500,
      expectedPayoutPaise: 238_334n,
    };
    const split = payoutSplit(snapshot);
    expect(split).toEqual({ baseSharePaise: 183_333n, addonSharePaise: 55_001n, travelPaise: 0n });
    expect(split.baseSharePaise + split.addonSharePaise + split.travelPaise).toBe(238_334n);
    expect(noShowIncentivePayout(snapshot)).toBe(366_666n + 55_001n);
  });

  it('applies a custom incentive with half-up rounding', () => {
    const snapshot = {
      baseAmountPaise: 100_001n,
      travelAmountPaise: 5_000n,
      payoutShareBps: 5000,
      expectedPayoutPaise: 55_001n,
    };
    // base share 50000.5 → 50001; × 1.5 = 75001.5 → 75002; addon share 0; + travel 5000.
    expect(noShowIncentivePayout(snapshot, 15_000)).toBe(80_002n);
  });

  it('refuses a snapshot whose payout is smaller than its own base share and travel', () => {
    expect(() =>
      payoutSplit({
        baseAmountPaise: 500_000n,
        travelAmountPaise: 20_000n,
        payoutShareBps: 6000,
        expectedPayoutPaise: 100_000n,
      }),
    ).toThrow(/inconsistent/);
  });
});
