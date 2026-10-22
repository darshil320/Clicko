/**
 * Pricing engine — doc 05 §10 test matrix, part 1 of 4:
 *   doc 05 §7 worked example · Base resolution · Duration · Emergency boundaries.
 * Parts 2–4: compute-quote.calendar.test.ts, compute-quote.charges.test.ts,
 * compute-quote.totals.test.ts.
 *
 * All money is bigint paise; all multipliers are basis points (10000 = 1.00×).
 */
import type { CityTier, EmergencyBand, PlanTier } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { computeQuote, LAUNCH_RULESET_VERSION, resolveEmergencyBand } from '../index';
import {
  HOUR_MS,
  hoursBefore,
  launch,
  MUMBAI,
  millihoursBefore,
  NEUTRAL_START,
  quoteOf,
  quoteRequest,
  RULESET_ID,
  SURAT,
  withoutBaseRate,
  workedExampleRequest,
} from './fixtures';

describe('doc 05 §7 worked example (Professional · Food · Surat · 2 h · wedding season · drone · 18 km · ₹200 off)', () => {
  // Hand arithmetic (integer paise; bps / 10000):
  //   rate      PROFESSIONAL × TIER_1                                     = 425000 /hr
  //   factors   FOOD 11500 · band NONE 10000 · wedding season 11500 · 15:00 IST 10000 · Tuesday 10000
  //   base      425000 × 4 half-hours × 11500 × 11500 / (2 × 10000²)
  //             = 850000 × 1.3225                                         = 1124125 (exact)
  //   NOTE: doc 05 §7 prints BASE = 977500 (= 850000 × 1.15). Its BASE line leaves surge out and
  //   shows it as a separate SURGE factor line; the engine multiplies surge into the base (§3 step 9).
  //   addons    DRONE, per booking, × 1                                   = 450000
  //   travel    18000 m → zone 1: 20000 + 1800 × 3000 / 1000             = 25400
  //   subtotal  1124125 + 450000 + 25400                                  = 1599525
  //   discount  flat ₹200                                                 = 20000
  //   taxable   1599525 − 20000                                           = 1579525
  //   gst       1579525 × 1800 / 10000 = 284314.5 → half-up               = 284315
  //   cgst      roundHalfUp(284315, 2) = 142157.5 → 142158;   sgst = 284315 − 142158 = 142157
  //   total     1579525 + 284315                                          = 1863840
  //   advance   ceil(1863840 / 2) = 931920;   balance = 1863840 − 931920 = 931920
  //   payout    (1124125 + 450000) × 6000 / 10000 = 944475;  + travel 25400 = 969875
  const workedExample = () => quoteOf(computeQuote(workedExampleRequest(), launch()));

  it('multiplies the Food uplift and wedding-season surge into a base of 1124125 paise', () => {
    const quote = workedExample();

    expect(quote.baseAmountPaise).toBe(1_124_125n);
  });

  it('charges the drone at a flat 450000 paise', () => {
    const quote = workedExample();

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  it('charges 25400 paise of zone 1 travel for 18 km', () => {
    const quote = workedExample();

    expect(quote).toMatchObject({ travelZone: 1, travelAmountPaise: 25_400n });
  });

  it('sums base, addons and travel into a subtotal of 1599525 paise', () => {
    const quote = workedExample();

    expect(quote.subtotalPaise).toBe(1_599_525n);
  });

  it('takes the flat ₹200 off before tax, leaving 1579525 paise taxable', () => {
    const quote = workedExample();

    expect(quote).toMatchObject({ discountAmountPaise: 20_000n, taxablePaise: 1_579_525n });
  });

  it('charges 284315 paise of GST, rounding the half paise up', () => {
    const quote = workedExample();

    expect(quote.gstAmountPaise).toBe(284_315n);
  });

  it('splits Gujarat GST into CGST 142158 and SGST 142157 with no IGST', () => {
    const quote = workedExample();

    expect(quote.gst).toEqual({
      rateBps: 1800,
      sac: '998383',
      placeOfSupply: '24',
      cgstPaise: 142_158n,
      sgstPaise: 142_157n,
      igstPaise: 0n,
    });
  });

  it('totals 1863840 paise', () => {
    const quote = workedExample();

    expect(quote.totalPaise).toBe(1_863_840n);
  });

  it('splits the total 50/50 into a 931920 advance and a 931920 balance', () => {
    const quote = workedExample();

    expect(quote).toMatchObject({ advancePaise: 931_920n, balancePaise: 931_920n });
  });

  it('expects a photographer payout of 969875 paise', () => {
    const quote = workedExample();

    expect(quote.expectedPayoutPaise).toBe(969_875n);
  });

  it('records every factor, including the ones at 1.00×', () => {
    const quote = workedExample();

    expect(quote.factors).toEqual({
      categoryUpliftBps: 11500,
      emergencyBps: 10000,
      surgeBps: 11500,
      nightBps: 10000,
      weekendBps: 10000,
    });
  });

  it('carries peak season, the airspace check and the promo code into the quote', () => {
    const quote = workedExample();

    expect(quote).toMatchObject({
      isPeakSeason: true,
      airspaceCheckRequired: true,
      promoCode: 'FIRST200',
    });
  });

  it('resolves the NONE band, guaranteed and captured normally', () => {
    const quote = workedExample();

    expect(quote).toMatchObject({
      emergencyBand: 'NONE',
      isGuaranteed: true,
      captureOnAcceptOnly: false,
      autoRefundMinutesBefore: null,
    });
  });
});

describe('Base resolution', () => {
  // 2 h = 4 half-hours; base = rate × 4 / 2 = rate × 2 (Portrait 1.00×, neutral slot).
  const grid: ReadonlyArray<{ tier: PlanTier; cityTier: CityTier; rate: bigint; base: bigint }> = [
    { tier: 'BASIC', cityTier: 'METRO', rate: 200_000n, base: 400_000n },
    { tier: 'BASIC', cityTier: 'TIER_1', rate: 175_000n, base: 350_000n },
    { tier: 'BASIC', cityTier: 'TIER_2', rate: 150_000n, base: 300_000n },
    { tier: 'BASIC', cityTier: 'TIER_3', rate: 135_000n, base: 270_000n },
    { tier: 'SEMI_PRO', cityTier: 'METRO', rate: 320_000n, base: 640_000n },
    { tier: 'SEMI_PRO', cityTier: 'TIER_1', rate: 275_000n, base: 550_000n },
    { tier: 'SEMI_PRO', cityTier: 'TIER_2', rate: 240_000n, base: 480_000n },
    { tier: 'SEMI_PRO', cityTier: 'TIER_3', rate: 210_000n, base: 420_000n },
    { tier: 'PROFESSIONAL', cityTier: 'METRO', rate: 500_000n, base: 1_000_000n },
    { tier: 'PROFESSIONAL', cityTier: 'TIER_1', rate: 425_000n, base: 850_000n },
    { tier: 'PROFESSIONAL', cityTier: 'TIER_2', rate: 370_000n, base: 740_000n },
    { tier: 'PROFESSIONAL', cityTier: 'TIER_3', rate: 320_000n, base: 640_000n },
    { tier: 'EXPERT', cityTier: 'METRO', rate: 820_000n, base: 1_640_000n },
    { tier: 'EXPERT', cityTier: 'TIER_1', rate: 700_000n, base: 1_400_000n },
    { tier: 'EXPERT', cityTier: 'TIER_2', rate: 610_000n, base: 1_220_000n },
    { tier: 'EXPERT', cityTier: 'TIER_3', rate: 530_000n, base: 1_060_000n },
  ];

  it.each(grid)(
    'prices 2 hours of $tier in a $cityTier city at $rate paise per hour',
    ({ tier, cityTier, rate, base }) => {
      const request = quoteRequest({ tier, venue: { ...SURAT, cityTier } });

      const quote = quoteOf(computeQuote(request, launch()));

      expect(quote).toMatchObject({ baseRatePerHourPaise: rate, baseAmountPaise: base });
    },
  );

  it('fails loudly with NO_BASE_RATE when the ruleset has no row for the tier and city tier', () => {
    const ruleset = withoutBaseRate(launch(), 'PROFESSIONAL', 'TIER_1');

    const result = computeQuote(quoteRequest(), ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'NO_BASE_RATE' });
  });

  it('returns QUOTE_ONLY for the Signature tier instead of a price', () => {
    const request = quoteRequest({ tier: 'SIGNATURE', hours: 4 });

    const result = computeQuote(request, launch());

    expect(result).toEqual({
      kind: 'QUOTE_ONLY',
      tier: 'SIGNATURE',
      rulesetVersion: LAUNCH_RULESET_VERSION,
    });
  });

  it('rejects a category that is not in the ruleset as UNKNOWN_CATEGORY', () => {
    const request = quoteRequest({ categoryCode: 'ASTROPHOTOGRAPHY' });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'UNKNOWN_CATEGORY' });
  });

  // 850000 × uplift / 10000
  const uplifts: ReadonlyArray<{ code: string; bps: number; base: bigint }> = [
    { code: 'PORTRAIT', bps: 10000, base: 850_000n },
    { code: 'EVENT', bps: 10000, base: 850_000n },
    { code: 'FOOD', bps: 11500, base: 977_500n },
    { code: 'PRODUCT', bps: 11000, base: 935_000n },
    { code: 'REAL_ESTATE', bps: 11000, base: 935_000n },
    { code: 'CORPORATE', bps: 12000, base: 1_020_000n },
    { code: 'WEDDING', bps: 12500, base: 1_062_500n },
  ];

  it.each(uplifts)('applies the $code uplift of $bps bps to the base', ({ code, bps, base }) => {
    const request = quoteRequest({ categoryCode: code });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ factors: { categoryUpliftBps: bps }, baseAmountPaise: base });
  });

  it('prefers a tier-specific category uplift over the tier-agnostic row', () => {
    const base = launch();
    const ruleset = {
      ...base,
      categoryUplifts: [
        ...base.categoryUplifts,
        { categoryCode: 'FOOD', tier: 'PROFESSIONAL' as const, multiplierBps: 13000 },
      ],
    };

    const quote = quoteOf(computeQuote(quoteRequest({ categoryCode: 'FOOD' }), ruleset));

    // 850000 × 1.30 = 1105000
    expect(quote).toMatchObject({
      factors: { categoryUpliftBps: 13000 },
      baseAmountPaise: 1_105_000n,
    });
  });

  it('falls back to the tier-agnostic uplift when only another tier has a specific row', () => {
    const base = launch();
    const ruleset = {
      ...base,
      categoryUplifts: [
        ...base.categoryUplifts,
        { categoryCode: 'FOOD', tier: 'EXPERT' as const, multiplierBps: 13000 },
      ],
    };

    const quote = quoteOf(computeQuote(quoteRequest({ categoryCode: 'FOOD' }), ruleset));

    expect(quote.factors.categoryUpliftBps).toBe(11500);
  });

  it('stamps the quote with the id and version of the ruleset it was priced under', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote).toMatchObject({ rulesetId: RULESET_ID, rulesetVersion: LAUNCH_RULESET_VERSION });
  });

  it("echoes the tier, the venue's city tier, the category and the hours onto the quote", () => {
    const request = quoteRequest({
      tier: 'EXPERT',
      categoryCode: 'WEDDING',
      venue: MUMBAI,
      hours: 3,
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({
      kind: 'QUOTE',
      tier: 'EXPERT',
      cityTier: 'METRO',
      categoryCode: 'WEDDING',
      hours: 3,
    });
  });
});

describe('Duration', () => {
  it('rejects a booking of 1.9 hours as under the 2 hour minimum', () => {
    const result = computeQuote(quoteRequest({ hours: 1.9 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it('accepts exactly 2.0 hours and prices 4 half-hours', () => {
    const quote = quoteOf(computeQuote(quoteRequest({ hours: 2 }), launch()));

    // 425000 × 4 / 2
    expect(quote.baseAmountPaise).toBe(850_000n);
  });

  it('accepts 2.5 hours and prices 5 half-hours', () => {
    const quote = quoteOf(computeQuote(quoteRequest({ hours: 2.5 }), launch()));

    // 425000 × 5 / 2
    expect(quote.baseAmountPaise).toBe(1_062_500n);
  });

  it('rejects 2.3 hours as not a multiple of half an hour', () => {
    const result = computeQuote(quoteRequest({ hours: 2.3 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_INCREMENT' });
  });

  it('rejects 2.25 hours as not a multiple of half an hour', () => {
    const result = computeQuote(quoteRequest({ hours: 2.25 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_INCREMENT' });
  });

  it('accepts 12 hours and prices 24 half-hours', () => {
    const quote = quoteOf(computeQuote(quoteRequest({ hours: 12 }), launch()));

    // 425000 × 24 / 2
    expect(quote.baseAmountPaise).toBe(5_100_000n);
  });

  it('rejects negative hours as under the minimum', () => {
    const result = computeQuote(quoteRequest({ hours: -2 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it('rejects zero hours as under the minimum', () => {
    const result = computeQuote(quoteRequest({ hours: 0 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it('rejects 1.5 hours, a valid increment, as under the minimum', () => {
    const result = computeQuote(quoteRequest({ hours: 1.5 }), launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it("rejects 2.5 hours when the ruleset's deliverable minimum is 3 hours", () => {
    const base = launch();
    const ruleset = {
      ...base,
      deliverables: base.deliverables.map((d) =>
        d.tier === 'PROFESSIONAL' ? { ...d, minHalfHours: 6 } : d,
      ),
    };

    const result = computeQuote(quoteRequest({ hours: 2.5 }), ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it("accepts exactly 3 hours when the ruleset's deliverable minimum is 3 hours", () => {
    const base = launch();
    const ruleset = {
      ...base,
      deliverables: base.deliverables.map((d) =>
        d.tier === 'PROFESSIONAL' ? { ...d, minHalfHours: 6 } : d,
      ),
    };

    const quote = quoteOf(computeQuote(quoteRequest({ hours: 3 }), ruleset));

    // 425000 × 6 / 2
    expect(quote.baseAmountPaise).toBe(1_275_000n);
  });

  it('validates the duration before looking up the base rate', () => {
    const ruleset = withoutBaseRate(launch(), 'PROFESSIONAL', 'TIER_1');

    const result = computeQuote(quoteRequest({ hours: 1.9 }), ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });
});

describe('Emergency boundaries', () => {
  // Lead time = scheduledStart − now. Every boundary is exclusive at the top.
  const boundaries: ReadonlyArray<{ lead: string; millihours: number; band: EmergencyBand }> = [
    { lead: 'exactly 3.0 h', millihours: 3_000, band: 'HOURS_3_8' },
    { lead: '2.999 h', millihours: 2_999, band: 'HOURS_UNDER_3' },
    { lead: 'exactly 8.0 h', millihours: 8_000, band: 'SAME_DAY' },
    { lead: '7.999 h', millihours: 7_999, band: 'HOURS_3_8' },
    { lead: 'exactly 24.0 h', millihours: 24_000, band: 'NEXT_DAY' },
    { lead: '23.999 h', millihours: 23_999, band: 'SAME_DAY' },
    { lead: 'exactly 48.0 h', millihours: 48_000, band: 'NONE' },
    { lead: '47.999 h', millihours: 47_999, band: 'NEXT_DAY' },
    { lead: '48.001 h', millihours: 48_001, band: 'NONE' },
  ];

  it.each(boundaries)('resolves a lead time of $lead to $band', ({ millihours, band }) => {
    const now = millihoursBefore(NEUTRAL_START, millihours);

    const resolved = resolveEmergencyBand(NEUTRAL_START, now);

    expect(resolved).toBe(band);
  });

  it('resolves a lead time one millisecond short of 3 hours to HOURS_UNDER_3', () => {
    const now = new Date(NEUTRAL_START.getTime() - 3 * HOUR_MS + 1);

    const resolved = resolveEmergencyBand(NEUTRAL_START, now);

    expect(resolved).toBe('HOURS_UNDER_3');
  });

  it('computes the band inside computeQuote from scheduledStart − now: exactly 3.0 h is HOURS_3_8', () => {
    const request = quoteRequest({ now: hoursBefore(NEUTRAL_START, 3) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ emergencyBand: 'HOURS_3_8', factors: { emergencyBps: 18000 } });
  });

  // Representative lead per band; base = 850000 × multiplier / 10000.
  const bands: ReadonlyArray<{
    band: EmergencyBand;
    leadHours: number;
    bps: number;
    base: bigint;
  }> = [
    { band: 'NONE', leadHours: 168, bps: 10000, base: 850_000n },
    { band: 'NEXT_DAY', leadHours: 30, bps: 12000, base: 1_020_000n },
    { band: 'SAME_DAY', leadHours: 12, bps: 14000, base: 1_190_000n },
    { band: 'HOURS_3_8', leadHours: 5, bps: 18000, base: 1_530_000n },
    { band: 'HOURS_UNDER_3', leadHours: 1, bps: 22000, base: 1_870_000n },
  ];

  it.each(bands)(
    'multiplies the base by the $band multiplier of $bps bps',
    ({ band, leadHours, bps, base }) => {
      const request = quoteRequest({ now: hoursBefore(NEUTRAL_START, leadHours) });

      const quote = quoteOf(computeQuote(request, launch()));

      expect(quote).toMatchObject({
        emergencyBand: band,
        factors: { emergencyBps: bps },
        baseAmountPaise: base,
      });
    },
  );

  const capture: ReadonlyArray<{
    band: EmergencyBand;
    leadHours: number;
    isGuaranteed: boolean;
    captureOnAcceptOnly: boolean;
    autoRefundMinutesBefore: number | null;
  }> = [
    {
      band: 'NONE',
      leadHours: 168,
      isGuaranteed: true,
      captureOnAcceptOnly: false,
      autoRefundMinutesBefore: null,
    },
    {
      band: 'NEXT_DAY',
      leadHours: 30,
      isGuaranteed: true,
      captureOnAcceptOnly: false,
      autoRefundMinutesBefore: null,
    },
    {
      band: 'SAME_DAY',
      leadHours: 12,
      isGuaranteed: true,
      captureOnAcceptOnly: false,
      autoRefundMinutesBefore: null,
    },
    {
      band: 'HOURS_3_8',
      leadHours: 5,
      isGuaranteed: true,
      captureOnAcceptOnly: false,
      autoRefundMinutesBefore: null,
    },
    {
      band: 'HOURS_UNDER_3',
      leadHours: 1,
      isGuaranteed: false,
      captureOnAcceptOnly: true,
      autoRefundMinutesBefore: 90,
    },
  ];

  it.each(capture)(
    "copies the $band band's guarantee and capture behaviour onto the quote",
    ({ leadHours, isGuaranteed, captureOnAcceptOnly, autoRefundMinutesBefore }) => {
      const request = quoteRequest({ now: hoursBefore(NEUTRAL_START, leadHours) });

      const quote = quoteOf(computeQuote(request, launch()));

      expect(quote).toMatchObject({ isGuaranteed, captureOnAcceptOnly, autoRefundMinutesBefore });
    },
  );

  // total = base + 18% GST (base × 1800 / 10000, exact for every row here).
  const splits: ReadonlyArray<{
    band: EmergencyBand;
    leadHours: number;
    advance: bigint;
    balance: bigint;
  }> = [
    // 850000 + 153000 = 1003000 → ceil(/2) = 501500
    { band: 'NONE', leadHours: 168, advance: 501_500n, balance: 501_500n },
    // 1020000 + 183600 = 1203600 → 601800
    { band: 'NEXT_DAY', leadHours: 30, advance: 601_800n, balance: 601_800n },
    // 1190000 + 214200 = 1404200, all upfront
    { band: 'SAME_DAY', leadHours: 12, advance: 1_404_200n, balance: 0n },
    // 1530000 + 275400 = 1805400, all upfront
    { band: 'HOURS_3_8', leadHours: 5, advance: 1_805_400n, balance: 0n },
    // 1870000 + 336600 = 2206600, all authorised upfront
    { band: 'HOURS_UNDER_3', leadHours: 1, advance: 2_206_600n, balance: 0n },
  ];

  it.each(splits)(
    'takes an advance of $advance and leaves a balance of $balance for a $band booking',
    ({ leadHours, advance, balance }) => {
      const request = quoteRequest({ now: hoursBefore(NEUTRAL_START, leadHours) });

      const quote = quoteOf(computeQuote(request, launch()));

      expect(quote).toMatchObject({ advancePaise: advance, balancePaise: balance });
    },
  );

  it('prices the 3-hour boundary at exactly ₹4,000 on a 2-hour Professional Mumbai booking', () => {
    const atThreeHours = quoteRequest({
      venue: MUMBAI,
      now: millihoursBefore(NEUTRAL_START, 3_000),
    });
    const justUnder = quoteRequest({ venue: MUMBAI, now: millihoursBefore(NEUTRAL_START, 2_999) });

    const hours38 = quoteOf(computeQuote(atThreeHours, launch()));
    const under3 = quoteOf(computeQuote(justUnder, launch()));

    // 1000000 × 2.2 − 1000000 × 1.8 = 2200000 − 1800000 = 400000 paise = ₹4,000
    expect(under3.baseAmountPaise - hours38.baseAmountPaise).toBe(400_000n);
  });

  it('rejects a start time equal to now as START_IN_PAST', () => {
    const request = quoteRequest({ now: NEUTRAL_START });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'START_IN_PAST' });
  });

  it('rejects a start time before now as START_IN_PAST', () => {
    const request = quoteRequest({ now: new Date(NEUTRAL_START.getTime() + 1) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'START_IN_PAST' });
  });

  it('fails loudly with NO_EMERGENCY_RULE when the ruleset has no row for the resolved band', () => {
    const base = launch();
    const ruleset = { ...base, emergency: base.emergency.filter((e) => e.band !== 'NEXT_DAY') };
    const request = quoteRequest({ now: hoursBefore(NEUTRAL_START, 30) });

    const result = computeQuote(request, ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'NO_EMERGENCY_RULE' });
  });
});
