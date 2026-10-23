import { describe, expect, it } from 'vitest';
import {
  chargeableWaitingMinutes,
  extensionCharge,
  type OnsiteChargeBasis,
  onsiteChargeBreakdown,
  type Ruleset,
  waitingCharge,
} from '../index';
import { launch } from './fixtures';

/** Professional · Food · Surat (TIER_1, Gujarat = Clickco's state → CGST + SGST). */
const SURAT_FOOD: OnsiteChargeBasis = {
  tier: 'PROFESSIONAL',
  cityTier: 'TIER_1',
  categoryCode: 'FOOD',
  placeOfSupply: '24',
  payoutShareBps: 6000,
};

function withRates(
  ruleset: Ruleset,
  patch: { hourlyPaise?: bigint; waitingHourlyPaise?: bigint },
): Ruleset {
  return {
    ...ruleset,
    extensionRates: ruleset.extensionRates.map((r) =>
      r.tier === 'PROFESSIONAL' && r.cityTier === 'TIER_1' ? { ...r, ...patch } : r,
    ),
  };
}

describe('extensionCharge (doc 05 §5: base hourly × category uplift only)', () => {
  it('prices one hour at ₹4,250 × 1.15 with exclusive GST split CGST/SGST', () => {
    const c = extensionCharge(launch(), SURAT_FOOD, 1);
    expect(c).toMatchObject({
      kind: 'EXTENSION',
      hours: 1,
      minutes: 60,
      baseRatePerHourPaise: 425_000n,
      categoryUpliftBps: 11_500,
      ratePerHourPaise: 488_750n,
      netPaise: 488_750n,
      taxablePaise: 488_750n,
      gstAmountPaise: 87_975n,
      totalPaise: 576_725n,
      pricesIncludeGst: false,
      payoutShareBps: 6000,
      expectedPayoutPaise: 293_250n,
    });
    expect(c.gst).toEqual({
      rateBps: 1800,
      sac: '998383',
      placeOfSupply: '24',
      cgstPaise: 43_988n,
      sgstPaise: 43_987n,
      igstPaise: 0n,
    });
    expect(c.taxablePaise + c.gstAmountPaise).toBe(c.totalPaise);
  });

  it('charges IGST when the venue is in another state (Mumbai, METRO)', () => {
    const c = extensionCharge(
      launch(),
      { ...SURAT_FOOD, cityTier: 'METRO', placeOfSupply: '27' },
      1,
    );
    expect(c.netPaise).toBe(575_000n);
    expect(c.gst).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 103_500n });
    expect(c.totalPaise).toBe(678_500n);
  });

  it('never carries surge, emergency, night or weekend: only BASE-style extension lines', () => {
    const c = extensionCharge(launch(), SURAT_FOOD, 1);
    expect(c.lines.map((l) => l.code)).toEqual(['EXTENSION']);
    expect(c.lines[0]).toMatchObject({
      label: 'Extension · Professional · Food · 1 hour',
      detail: '₹4,887.50/hr × 1 hr',
      amountPaise: 488_750n,
    });
  });

  it('derives GST by subtraction for an inclusive ruleset; the snapshot base is the taxable value', () => {
    const c = extensionCharge({ ...launch(), pricesIncludeGst: true }, SURAT_FOOD, 1);
    expect(c.totalPaise).toBe(488_750n);
    expect(c.taxablePaise).toBe(414_195n);
    expect(c.gstAmountPaise).toBe(74_555n);
    expect(c.snapshotBasePaise).toBe(c.taxablePaise);
    expect(c.gst).toMatchObject({ cgstPaise: 37_278n, sgstPaise: 37_277n });
  });

  it('refuses a tier with no extension rate and a non-positive number of hours', () => {
    expect(() => extensionCharge(launch(), { ...SURAT_FOOD, tier: 'SIGNATURE' }, 1)).toThrow();
    expect(() => extensionCharge(launch(), SURAT_FOOD, 0)).toThrow(RangeError);
    expect(() => extensionCharge(launch(), SURAT_FOOD, 1.5)).toThrow(RangeError);
  });
});

describe('chargeableWaitingMinutes (T&C §2.6: 15-minute grace, capped at 60)', () => {
  it.each([
    [1, 0],
    [10, 0],
    [15, 0],
    [16, 1],
    [40, 25],
    [60, 45],
    [61, 45],
    [240, 45],
  ])('%i minutes waited → %i chargeable', (waited, chargeable) => {
    expect(chargeableWaitingMinutes(waited, 15, 60)).toBe(chargeable);
  });

  it('uses the ruleset grace, and refuses negative or fractional minutes', () => {
    expect(chargeableWaitingMinutes(40, 10, 60)).toBe(30);
    expect(() => chargeableWaitingMinutes(-1, 15, 60)).toThrow(RangeError);
    expect(() => chargeableWaitingMinutes(2.5, 15, 60)).toThrow(RangeError);
  });
});

describe('waitingCharge (60% of the extension hourly × uplift, pro rata per minute)', () => {
  it('prices 25 chargeable minutes with one half-up rounding, then GST', () => {
    const c = waitingCharge(launch(), SURAT_FOOD, 25);
    expect(c).toMatchObject({
      kind: 'WAITING',
      hours: 0,
      minutes: 25,
      baseRatePerHourPaise: 255_000n,
      ratePerHourPaise: 293_250n,
      netPaise: 122_188n,
      gstAmountPaise: 21_994n,
      totalPaise: 144_182n,
      expectedPayoutPaise: 73_313n,
    });
    expect(c.lines[0]).toMatchObject({ code: 'WAITING', detail: '₹2,932.50/hr × 25 min' });
  });

  it('rounds once on the line, never on a pre-rounded hourly rate', () => {
    // 100001 × 1.15 × 27/60 = 51750.5…  →  51751; rounding the hourly first would give 51750.
    const c = waitingCharge(withRates(launch(), { waitingHourlyPaise: 100_001n }), SURAT_FOOD, 27);
    expect(c.netPaise).toBe(51_751n);
  });

  it('is zero (and GST-free) for zero chargeable minutes', () => {
    const c = waitingCharge(launch(), SURAT_FOOD, 0);
    expect(c.netPaise).toBe(0n);
    expect(c.totalPaise).toBe(0n);
    expect(c.expectedPayoutPaise).toBe(0n);
  });

  it('refuses negative or fractional minutes', () => {
    expect(() => waitingCharge(launch(), SURAT_FOOD, -1)).toThrow(RangeError);
    expect(() => waitingCharge(launch(), SURAT_FOOD, 1.5)).toThrow(RangeError);
  });
});

describe('onsiteChargeBreakdown (the snapshot breakdown JSON, doc 05 §7 shape)', () => {
  it('records the kind, the line, GST, neutral factors and the request it answers', () => {
    const c = extensionCharge(launch(), SURAT_FOOD, 1);
    const json = onsiteChargeBreakdown(c, {
      computedAt: new Date('2026-11-15T09:00:00.000Z'),
      assignmentEventId: '42',
    });
    expect(json).toEqual({
      currency: 'INR',
      kind: 'EXTENSION',
      pricesIncludeGst: false,
      lines: [
        {
          code: 'EXTENSION',
          label: 'Extension · Professional · Food · 1 hour',
          detail: '₹4,887.50/hr × 1 hr',
          amountPaise: 488_750,
        },
      ],
      minutes: 60,
      subtotalPaise: 488_750,
      gst: {
        rateBps: 1800,
        sac: '998383',
        placeOfSupply: '24',
        cgstPaise: 43_988,
        sgstPaise: 43_987,
        igstPaise: 0,
      },
      totalPaise: 576_725,
      factorsApplied: {
        categoryUpliftBps: 11_500,
        emergencyBps: 10_000,
        surgeBps: 10_000,
        nightBps: 10_000,
        weekendBps: 10_000,
      },
      rulesetVersion: '2026.10.01',
      assignmentEventId: '42',
      computedAt: '2026-11-15T09:00:00.000Z',
    });
  });
});
