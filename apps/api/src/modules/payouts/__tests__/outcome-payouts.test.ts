import { describe, expect, it } from 'vitest';
import {
  dataLossWithheld,
  OUTCOME_PAYOUT_RULES,
  outcomeGross,
  type PayoutBasis,
} from '../rules/outcome-payouts';

/**
 * ADR-0027 D5: what a photographer is owed when a shoot ends without a delivery, beside the
 * delivered payout (ADR-0026 D3). Bigint paise; one half-up rounding per payout.
 */
describe('outcome payouts (ADR-0027 D5)', () => {
  const job = { basePaise: 520_001n, extrasPaise: 99_999n, travelPaise: 0n };

  it('a delivered booking pays the accepted offer plus the extension and waiting shares', () => {
    expect(outcomeGross('DELIVERED', job)).toEqual({ grossPaise: 620_000n, shareBps: 10_000 });
  });

  it('data loss pays the photographer in full, extras included (DOMAIN §2, v0.2 G-13)', () => {
    expect(outcomeGross('DATA_LOSS', job)).toEqual({ grossPaise: 620_000n, shareBps: 10_000 });
  });

  it('access denied pays the share of the 50% charged, rounded half-up once (T&C §7.2)', () => {
    // (520_001 + 99_999) × 50% = 310_000 exactly; an odd total rounds the half paisa up.
    expect(outcomeGross('ACCESS_DENIED', job)).toEqual({ grossPaise: 310_000n, shareBps: 5_000 });
    expect(
      outcomeGross('ACCESS_DENIED', { basePaise: 100_001n, extrasPaise: 0n, travelPaise: 0n })
        .grossPaise,
    ).toBe(50_001n);
  });

  it('access denied still passes travel through at 100% (doc 05 step 12: fuel was spent)', () => {
    // (520_001 + 99_999 − 20_000) × 50% + 20_000 = 300_000 + 20_000
    expect(outcomeGross('ACCESS_DENIED', { ...job, travelPaise: 20_000n }).grossPaise).toBe(
      320_000n,
    );
    // Travel is never more than the payout it is part of.
    expect(
      outcomeGross('ACCESS_DENIED', { basePaise: 1_000n, extrasPaise: 0n, travelPaise: 5_000n })
        .grossPaise,
    ).toBe(1_000n);
    // Paid in full anyway: travel changes nothing for the other outcomes.
    expect(outcomeGross('DATA_LOSS', { ...job, travelPaise: 20_000n }).grossPaise).toBe(620_000n);
  });

  it('client absent pays the booked payout but not the waived waiting share (ADR-0016 D12)', () => {
    expect(outcomeGross('CLIENT_ABSENT', job)).toEqual({ grossPaise: 520_001n, shareBps: 10_000 });
  });

  it('never pays a negative or fractional amount', () => {
    for (const basis of Object.keys(OUTCOME_PAYOUT_RULES) as PayoutBasis[]) {
      const { grossPaise } = outcomeGross(basis, {
        basePaise: 0n,
        extrasPaise: 0n,
        travelPaise: 0n,
      });
      expect(grossPaise).toBe(0n);
    }
    expect(() =>
      outcomeGross('DATA_LOSS', { basePaise: -1n, extrasPaise: 0n, travelPaise: 0n }),
    ).toThrow(RangeError);
  });

  it('the third data loss in the window is withheld (2 incidents per photographer per year)', () => {
    expect(dataLossWithheld(0)).toBe(false);
    expect(dataLossWithheld(1)).toBe(false);
    expect(dataLossWithheld(2)).toBe(true);
    expect(dataLossWithheld(5)).toBe(true);
    expect(OUTCOME_PAYOUT_RULES.DATA_LOSS.shareBps).toBe(10_000);
  });
});
