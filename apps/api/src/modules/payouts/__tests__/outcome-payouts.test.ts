import { describe, expect, it } from 'vitest';
import {
  CLIENT_CANCELLATION_PAYOUT,
  cancellationPayout,
  dataLossWithheld,
  type FixedShareBasis,
  OUTCOME_PAYOUT_RULES,
  outcomeGross,
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
    for (const basis of Object.keys(OUTCOME_PAYOUT_RULES) as FixedShareBasis[]) {
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

/**
 * A client cancelled after this photographer accepted (T&C §3.1–§3.3). No spec names the amount:
 * the photographer gets their share of what the client is charged — the doc 05 step 12 principle
 * ACCESS_DENIED already follows — i.e. the full payout scaled by the part of the booking value
 * Clickco keeps. Owner-overridable (CLIENT_CANCELLATION_PAYOUT).
 */
describe('client cancellation payout (owner-overridable)', () => {
  const job = { basePaise: 520_000n, extrasPaise: 0n, travelPaise: 20_000n };

  it('scales the full payout by the share of the booking value kept, rounded half-up once', () => {
    // Kept ₹2,507.50 of ₹10,030: 25 % of the ₹5,200 payout.
    expect(cancellationPayout(job, { keptPaise: 250_750n, bookingTotalPaise: 1_003_000n })).toEqual(
      { grossPaise: 130_000n, shareBps: 2_500 },
    );
    // An odd ratio: 520_000 × 1/3 = 173_333.33 → 173_333; 3_333.33 bps → 3_333.
    expect(
      cancellationPayout(job, { keptPaise: 1_000_000n, bookingTotalPaise: 3_000_000n }),
    ).toEqual({ grossPaise: 173_333n, shareBps: 3_333 });
  });

  it('everything kept (an emergency booking cancelled after acceptance) pays the full payout', () => {
    expect(
      cancellationPayout(job, { keptPaise: 1_003_000n, bookingTotalPaise: 1_003_000n }),
    ).toEqual({ grossPaise: 520_000n, shareBps: 10_000 });
  });

  it('nothing kept pays nothing', () => {
    expect(cancellationPayout(job, { keptPaise: 0n, bookingTotalPaise: 1_003_000n })).toEqual({
      grossPaise: 0n,
      shareBps: 0,
    });
    expect(CLIENT_CANCELLATION_PAYOUT.enabled).toBe(true);
  });

  it('cancelled while the photographer was on the way: travel passes through, within what was kept', () => {
    // Before EN_ROUTE: travel is shared like the rest (25 % of 520_000 = 130_000).
    expect(
      cancellationPayout(job, { keptPaise: 250_750n, bookingTotalPaise: 1_003_000n }).grossPaise,
    ).toBe(130_000n);
    // EN_ROUTE: (520_000 − 20_000) × 25 % + 20_000 travel = 125_000 + 20_000.
    expect(
      cancellationPayout(job, {
        keptPaise: 250_750n,
        bookingTotalPaise: 1_003_000n,
        enRoute: true,
      }),
    ).toEqual({ grossPaise: 145_000n, shareBps: 2_500 });
    // Kept less than the travel: Clickco never pays out more than it kept.
    expect(
      cancellationPayout(job, { keptPaise: 15_000n, bookingTotalPaise: 1_003_000n, enRoute: true })
        .grossPaise,
    ).toBe(15_000n);
  });

  it('never pays more than the full payout, and refuses impossible inputs', () => {
    expect(
      cancellationPayout(job, { keptPaise: 2_000_000n, bookingTotalPaise: 1_003_000n }).grossPaise,
    ).toBe(520_000n);
    expect(() => cancellationPayout(job, { keptPaise: 1n, bookingTotalPaise: 0n })).toThrow(
      RangeError,
    );
    expect(() => cancellationPayout(job, { keptPaise: -1n, bookingTotalPaise: 10n })).toThrow(
      RangeError,
    );
    expect(() =>
      cancellationPayout({ ...job, basePaise: -1n }, { keptPaise: 1n, bookingTotalPaise: 10n }),
    ).toThrow(RangeError);
  });
});
