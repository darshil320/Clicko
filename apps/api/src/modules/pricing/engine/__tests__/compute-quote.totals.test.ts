/**
 * Pricing engine — doc 05 §10 test matrix, part 4 of 4:
 *   GST · Rounding · Snapshot integrity (engine level) · Breakdown JSON · priceExtension.
 *
 * DB-level snapshot integrity (UPDATE trigger on booking_price_snapshots, sequence 2 written for an
 * extension without touching sequence 1) belongs to the persistence tests, not this pure engine.
 *
 * roundHalfUp(n, d) = (2n + d) / 2d, applied once per line item.
 */
import { describe, expect, it } from 'vitest';
import { computeQuote, LAUNCH_RULESET_VERSION, priceExtension, toBreakdownJson } from '../index';
import {
  containsBigint,
  deepFreeze,
  hoursBefore,
  ist,
  launch,
  MINUTE_MS,
  MUMBAI,
  NEUTRAL_NOW,
  promo,
  quoteOf,
  quoteRequest,
  SURAT,
  startingAt,
  sumLineAmounts,
  withBaseRate,
  workedExampleRequest,
} from './fixtures';

/** The launch ruleset switched to GST-inclusive prices (the non-default branch of OD-01). */
const inclusive = () => ({ ...launch(), pricesIncludeGst: true });

describe('GST', () => {
  it('adds 18% GST on top of the taxable amount when prices exclude GST', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    // 850000 × 1800 / 10000 = 153000; total 1003000 ("₹8,500 + GST → ₹10,030", doc 05 §6)
    expect(quote).toMatchObject({ gstAmountPaise: 153_000n, totalPaise: 1_003_000n });
  });

  it('derives inclusive GST by subtraction so the total stays exactly the subtotal', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, inclusive()));

    // subtotal 850000 + (20000 + roundHalfUp(1800 × 2, 1000) = 20004) = 870004 = total
    // taxable  roundHalfUp(870004 × 10000, 11800) = 737291.52… → 737292
    // gst      870004 − 737292 = 132712
    //          (rounding it on its own, 737292 × 0.18 = 132712.56 → 132713, would total 870005)
    expect(quote).toMatchObject({
      totalPaise: 870_004n,
      taxablePaise: 737_292n,
      gstAmountPaise: 132_712n,
    });
  });

  it('marks the quote as GST-inclusive when the ruleset is', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), inclusive()));

    expect(quote.pricesIncludeGst).toBe(true);
  });

  it('splits intra-state GST into CGST and SGST, giving the odd paise to CGST', () => {
    const request = quoteRequest({ venue: SURAT, travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, launch()));

    // taxable 870004 × 0.18 = 156600.72 → 156601; cgst roundHalfUp(156601, 2) = 78301; sgst 78300
    expect(quote.gst).toMatchObject({ cgstPaise: 78_301n, sgstPaise: 78_300n, igstPaise: 0n });
  });

  it('charges the full rate as IGST for a venue in another state', () => {
    const request = quoteRequest({ venue: MUMBAI });

    const quote = quoteOf(computeQuote(request, launch()));

    // METRO 1000000 × 0.18 = 180000
    expect(quote.gst).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 180_000n });
  });

  it("takes the place of supply from the venue's GST state, not its city", () => {
    const request = quoteRequest({ venue: { ...SURAT, gstStateCode: '27' } });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.gst).toMatchObject({ placeOfSupply: '27', igstPaise: 153_000n, cgstPaise: 0n });
  });

  it.each(['24', '27'])(
    'makes exactly one of CGST+SGST or IGST non-zero, summing to the GST, for state %s',
    (gstStateCode) => {
      const request = quoteRequest({
        venue: { ...SURAT, gstStateCode },
        travelDistanceMetres: 15_002,
      });

      const { gst, gstAmountPaise } = quoteOf(computeQuote(request, launch()));

      expect(gst.cgstPaise + gst.sgstPaise > 0n).not.toBe(gst.igstPaise > 0n);
      expect(gst.cgstPaise + gst.sgstPaise + gst.igstPaise).toBe(gstAmountPaise);
    },
  );

  it('charges no GST and totals the taxable amount at a 0% rate', () => {
    const ruleset = { ...launch(), gstRateBps: 0 };

    const quote = quoteOf(computeQuote(quoteRequest(), ruleset));

    expect(quote).toMatchObject({ gstAmountPaise: 0n, totalPaise: 850_000n });
  });

  it('leaves every GST branch at zero at a 0% rate', () => {
    const ruleset = { ...launch(), gstRateBps: 0 };

    const quote = quoteOf(computeQuote(quoteRequest(), ruleset));

    expect(quote.gst).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 0n });
  });

  it('makes the line items sum exactly to the taxable amount', () => {
    const quote = quoteOf(computeQuote(workedExampleRequest(), launch()));

    expect(sumLineAmounts(quote.lines)).toBe(quote.taxablePaise);
  });

  it('makes taxable + GST equal the total exactly when prices exclude GST', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.taxablePaise + quote.gstAmountPaise).toBe(quote.totalPaise);
  });

  it('makes taxable + GST equal the total exactly when prices include GST', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, inclusive()));

    expect(quote.taxablePaise + quote.gstAmountPaise).toBe(quote.totalPaise);
  });

  it('rounds a GST amount of exactly half a paise up', () => {
    const ruleset = withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 340_010n);
    const request = quoteRequest({ hours: 2.5 });

    const quote = quoteOf(computeQuote(request, ruleset));

    // base 340010 × 5 / 2 = 850025; × 0.18 = 153004.5 → 153005; total 1003030
    expect(quote).toMatchObject({ gstAmountPaise: 153_005n, totalPaise: 1_003_030n });
  });

  it('records the GST rate, SAC code and place of supply', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote.gst).toMatchObject({ rateBps: 1800, sac: '998383', placeOfSupply: '24' });
  });
});

describe('Rounding', () => {
  it('rounds a base of exactly half a paise up, not to even', () => {
    const ruleset = withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 425_001n);
    const request = quoteRequest({ hours: 2.5 });

    const quote = quoteOf(computeQuote(request, ruleset));

    // 425001 × 5 / 2 = 1062502.5 → 1062503 (banker's rounding would give 1062502)
    expect(quote.baseAmountPaise).toBe(1_062_503n);
  });

  it('rounds every line before summing, so the subtotal is 1437506 rather than 1437505', () => {
    const base = withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 425_001n);
    const ruleset = {
      ...base,
      addonPrices: base.addonPrices.map((p) =>
        p.addonCode === 'SECOND_SHOOTER' ? { ...p, amountPaise: 150_001n } : p,
      ),
    };
    const request = quoteRequest({ hours: 2.5, addons: [{ code: 'SECOND_SHOOTER', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, ruleset));

    // base 1062502.5 → 1062503; addon 150001 × 5 / 2 = 375002.5 → 375003; Σ = 1437506
    // (rounding the unrounded sum 1437505.0 would give 1437505)
    expect(quote.subtotalPaise).toBe(1_437_506n);
  });

  it('rounds 2.5 h × 1.15 × 1.15 × 1.10 once, to 1545672 paise', () => {
    // Food (1.15) · wedding season (1.15) · Saturday (1.10), Sat 21 Nov 2026 11:00 IST
    const request = quoteRequest({
      ...startingAt('2026-11-21T11:00'),
      categoryCode: 'FOOD',
      hours: 2.5,
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // 425000 × 5 × 11500 × 11500 × 11000 / (2 × 10000³) = 1545671.875 → 1545672
    expect(quote.baseAmountPaise).toBe(1_545_672n);
  });

  it('holds the snapshot CHECK constraints on 2.5 h × 1.15 × 1.15 × 1.10 with addons, travel and a promo', () => {
    const request = quoteRequest({
      ...startingAt('2026-11-21T11:00'),
      categoryCode: 'FOOD',
      hours: 2.5,
      addons: [{ code: 'DRONE', quantity: 1 }],
      travelDistanceMetres: 18_000,
      promo: promo({ discountBps: 1000, discountFlatPaise: null }),
    });

    const q = quoteOf(computeQuote(request, launch()));

    expect(q.taxablePaise).toBe(
      q.baseAmountPaise + q.addonsAmountPaise + q.travelAmountPaise - q.discountAmountPaise,
    );
    expect(q.totalPaise).toBe(q.taxablePaise + q.gstAmountPaise);
    expect(q.advancePaise + q.balancePaise).toBe(q.totalPaise);
  });

  it('matches exact integer maths where floating point lands a paise short', () => {
    const ruleset = withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 425_100n);
    const request = quoteRequest({ ...startingAt('2026-11-17T11:00'), categoryCode: 'FOOD' });

    const quote = quoteOf(computeQuote(request, ruleset));

    // exact: 425100 × 2 × 1.15 × 1.15 = 1124389.5 → 1124390
    // float: 425100 * 2 * 1.15 * 1.15 = 1124389.4999999998 → Math.round = 1124389
    expect(quote.baseAmountPaise).toBe(1_124_390n);
  });

  it('returns every money amount on the quote as a bigint', () => {
    const quote = quoteOf(computeQuote(workedExampleRequest(), launch()));

    const amounts = [
      quote.baseRatePerHourPaise,
      quote.baseAmountPaise,
      quote.addonsAmountPaise,
      quote.travelAmountPaise,
      quote.subtotalPaise,
      quote.discountAmountPaise,
      quote.taxablePaise,
      quote.gstAmountPaise,
      quote.gst.cgstPaise,
      quote.gst.sgstPaise,
      quote.gst.igstPaise,
      quote.totalPaise,
      quote.advancePaise,
      quote.balancePaise,
      quote.expectedPayoutPaise,
      ...quote.lines.flatMap((l) => (l.amountPaise === undefined ? [] : [l.amountPaise])),
    ];
    expect(amounts.map((a) => typeof a)).toEqual(amounts.map(() => 'bigint'));
  });

  it('stays exact past 2^64 at 12 hours × ₹49,999.52/hr × every maximum factor', () => {
    // Expert at a Signature-scale rate · Wedding 1.25 · HOURS_UNDER_3 2.2 · Diwali 1.25 (MAX over
    // wedding season) · night 1.25 · Saturday 1.10 — Sat 7 Nov 2026 23:00 IST, quoted 2.5 h ahead.
    const ruleset = withBaseRate(launch(), 'EXPERT', 'TIER_1', 4_999_952n);
    const scheduledStart = ist('2026-11-07T23:00');
    const request = quoteRequest({
      tier: 'EXPERT',
      categoryCode: 'WEDDING',
      hours: 12,
      scheduledStart,
      now: hoursBefore(scheduledStart, 2.5),
    });

    const quote = quoteOf(computeQuote(request, ruleset));

    // numerator 4999952 × 24 × 12500 × 22000 × 12500 × 12500 × 11000 ≈ 5.67e28 (> 2^64 ≈ 1.8e19)
    // = 4999952 × 1815 / 32 = 283591027.5 → 283591028
    // (Number(numerator) / 2e20 rounds to 283591027)
    expect(quote.baseAmountPaise).toBe(283_591_028n);
  });
});

describe('Snapshot integrity', () => {
  it('returns deep-equal quotes for identical inputs', () => {
    const first = computeQuote(workedExampleRequest(), launch());

    const second = computeQuote(workedExampleRequest(), launch());

    expect(second).toEqual(first);
  });

  it('prices without mutating the request or the ruleset', () => {
    const request = deepFreeze(workedExampleRequest());
    const ruleset = deepFreeze(launch());

    const result = computeQuote(request, ruleset);

    expect(result.kind).toBe('QUOTE');
  });

  it('reprices a ruleset-A booking identically after ruleset B has been used', () => {
    const rulesetA = launch();
    const rulesetB = {
      ...withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 500_000n),
      id: 'ruleset-b',
      version: '2027.04.01',
    };
    const before = computeQuote(quoteRequest(), rulesetA);
    computeQuote(quoteRequest(), rulesetB);

    const after = computeQuote(quoteRequest(), rulesetA);

    expect(after).toEqual(before);
  });

  it('prices only from the ruleset passed in', () => {
    const rulesetB = {
      ...withBaseRate(launch(), 'PROFESSIONAL', 'TIER_1', 500_000n),
      id: 'ruleset-b',
      version: '2027.04.01',
    };

    const quote = quoteOf(computeQuote(quoteRequest(), rulesetB));

    expect(quote).toMatchObject({
      rulesetId: 'ruleset-b',
      rulesetVersion: '2027.04.01',
      baseAmountPaise: 1_000_000n,
    });
  });

  it('sets computedAt to the supplied now, never the wall clock', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote.computedAt.getTime()).toBe(NEUTRAL_NOW.getTime());
  });

  it('expires the quote exactly 15 minutes after now', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote.quoteExpiresAt.getTime()).toBe(NEUTRAL_NOW.getTime() + 15 * MINUTE_MS);
  });

  it('makes advance + balance equal an odd total exactly', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, launch()));

    // total 870004 + 156601 = 1026605 (odd)
    expect(quote.advancePaise + quote.balancePaise).toBe(quote.totalPaise);
  });

  it('gives the odd paise of a 50/50 split to the advance', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_002 });

    const quote = quoteOf(computeQuote(request, launch()));

    // ceil(1026605 / 2) = 513303; 1026605 − 513303 = 513302
    expect(quote).toMatchObject({ advancePaise: 513_303n, balancePaise: 513_302n });
  });
});

describe('Breakdown JSON (doc 05 §7)', () => {
  const workedExampleBreakdown = () =>
    toBreakdownJson(quoteOf(computeQuote(workedExampleRequest(), launch())));

  it('renders the doc 05 §7 envelope for the worked example', () => {
    const breakdown = workedExampleBreakdown();

    // Numbers per the worked-example arithmetic in compute-quote.test.ts.
    expect(breakdown).toMatchObject({
      currency: 'INR',
      pricesIncludeGst: false,
      gst: {
        rateBps: 1800,
        sac: '998383',
        placeOfSupply: '24',
        cgstPaise: 142_158,
        sgstPaise: 142_157,
        igstPaise: 0,
      },
      totalPaise: 1_863_840,
      advancePaise: 931_920,
      balancePaise: 931_920,
      rulesetVersion: LAUNCH_RULESET_VERSION,
      computedAt: '2026-11-04T11:22:31.442Z',
    });
  });

  it('records all five factors, including the ones at 1.00×', () => {
    const breakdown = workedExampleBreakdown();

    expect(breakdown.factorsApplied).toEqual({
      categoryUpliftBps: 11500,
      emergencyBps: 10000,
      surgeBps: 11500,
      nightBps: 10000,
      weekendBps: 10000,
    });
  });

  it('renders line amounts as JS numbers, with the discount as a negative line', () => {
    const breakdown = workedExampleBreakdown();

    // BASE is 1124125 (surge included), not doc 05 §7's illustrative 977500.
    expect(breakdown.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'BASE', amountPaise: 1_124_125 }),
        expect.objectContaining({ code: 'ADDON_DRONE', amountPaise: 450_000 }),
        expect.objectContaining({ code: 'TRAVEL', amountPaise: 25_400 }),
        expect.objectContaining({ code: 'DISCOUNT', amountPaise: -20_000 }),
      ]),
    );
  });

  it('shows the festival surge as a factor line', () => {
    const breakdown = workedExampleBreakdown();

    expect(breakdown.lines).toContainEqual(
      expect.objectContaining({ code: 'SURGE', isFactor: true, factorBps: 11500 }),
    );
  });

  it('renders subtotal, total, advance and balance as JS integers', () => {
    const request = quoteRequest({
      addons: [{ code: 'DRONE', quantity: 1 }],
      travelDistanceMetres: 18_000,
    });

    const breakdown = toBreakdownJson(quoteOf(computeQuote(request, launch())));

    // 850000 + 450000 + 25400 = 1325400; GST 238572; total 1563972; ceil(/2) = 781986
    expect(breakdown).toMatchObject({
      subtotalPaise: 1_325_400,
      totalPaise: 1_563_972,
      advancePaise: 781_986,
      balancePaise: 781_986,
    });
  });

  it('survives JSON.stringify then JSON.parse unchanged', () => {
    const breakdown = workedExampleBreakdown();

    const roundTripped = JSON.parse(JSON.stringify(breakdown));

    expect(roundTripped).toEqual(breakdown);
  });

  it('contains no bigint at any depth', () => {
    const breakdown = workedExampleBreakdown();

    expect(containsBigint(breakdown)).toBe(false);
  });
});

describe('priceExtension', () => {
  it('prices a Professional Food extension in a TIER_1 city at base hourly × 1.15', () => {
    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', launch());

    // hourly 425000 × 1.15 = 488750; waiting (425000 × 0.60 = 255000) × 1.15 = 293250
    expect(price).toEqual({
      hourlyPaise: 488_750n,
      waitingHourlyPaise: 293_250n,
      waitingGraceMinutes: 15,
    });
  });

  it('prices a Portrait extension at the plain base hourly', () => {
    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'PORTRAIT', launch());

    expect(price).toMatchObject({ hourlyPaise: 425_000n, waitingHourlyPaise: 255_000n });
  });

  it('prices an Expert Wedding extension in a METRO city', () => {
    const price = priceExtension('EXPERT', 'METRO', 'WEDDING', launch());

    // 820000 × 1.25 = 1025000; waiting 492000 × 1.25 = 615000
    expect(price).toMatchObject({ hourlyPaise: 1_025_000n, waitingHourlyPaise: 615_000n });
  });

  it('rounds the uplifted extension rate half-up', () => {
    const base = launch();
    const ruleset = {
      ...base,
      extensionRates: base.extensionRates.map((r) =>
        r.tier === 'PROFESSIONAL' && r.cityTier === 'TIER_1' ? { ...r, hourlyPaise: 425_010n } : r,
      ),
    };

    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', ruleset);

    // 425010 × 1.15 = 488761.5 → 488762
    expect(price.hourlyPaise).toBe(488_762n);
  });

  it('prefers a tier-specific category uplift', () => {
    const base = launch();
    const ruleset = {
      ...base,
      categoryUplifts: [
        ...base.categoryUplifts,
        { categoryCode: 'FOOD', tier: 'PROFESSIONAL' as const, multiplierBps: 13000 },
      ],
    };

    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', ruleset);

    // 425000 × 1.30
    expect(price.hourlyPaise).toBe(552_500n);
  });

  it("takes the waiting grace period from the ruleset's extension rule", () => {
    const base = launch();
    const ruleset = {
      ...base,
      extensionRates: base.extensionRates.map((r) => ({ ...r, waitingGraceMinutes: 20 })),
    };

    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', ruleset);

    expect(price.waitingGraceMinutes).toBe(20);
  });

  it('ignores every surge, emergency, night and weekend rule in the ruleset', () => {
    const base = launch();
    const hostile = {
      ...base,
      emergency: base.emergency.map((e) => ({ ...e, multiplierBps: 30000 })),
      night: { windowStartMinute: 0, windowEndMinute: 24 * 60, multiplierBps: 20000 },
      weekend: { isoDays: [1, 2, 3, 4, 5, 6, 7], multiplierBps: 20000 },
      festivals: [
        {
          label: 'Always',
          dateFrom: '2000-01-01',
          dateTo: '2099-12-31',
          cityId: null,
          multiplierBps: 20000,
          isPeakSeason: true,
        },
      ],
    };

    const price = priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', hostile);

    expect(price).toEqual({
      hourlyPaise: 488_750n,
      waitingHourlyPaise: 293_250n,
      waitingGraceMinutes: 15,
    });
  });
});
