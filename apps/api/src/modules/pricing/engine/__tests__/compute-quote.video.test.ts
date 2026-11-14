/**
 * ADR-0034 — the owner's videography rate card in ruleset 2026.11.14.
 *   VIDEOGRAPHER  per hour by tier: Basic ₹2,000 · Semi-Pro ("Advanced") ₹3,000 ·
 *                 Professional ₹5,000 · Expert ₹5,000 (top video rate). Same for every city tier.
 *   REELS         ₹3,000 per reel; 5 or more reels → ₹2,000 per reel for ALL of them.
 *   RAW_FOOTAGE   ₹1,000 flat per booking.
 * Reels and raw footage need the videographer. None of them takes a multiplier (Invariant 6).
 */
import type { PlanTier } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { computeQuote, type Ruleset, VIDEO_RULESET_VERSION } from '../index';
import {
  hoursBefore,
  ist,
  launch,
  MUMBAI,
  quoteOf,
  quoteRequest,
  sumLineAmounts,
  videoCard,
} from './fixtures';

const VIDEO = { code: 'VIDEOGRAPHER', quantity: 1 } as const;
const reels = (quantity: number) => ({ code: 'REELS', quantity });
const RAW = { code: 'RAW_FOOTAGE', quantity: 1 } as const;

/** Saturday 7 Nov 2026, 23:00 IST, 2.5 h ahead: Diwali week, night, weekend and an urgent band. */
const everyFactor = () => {
  const scheduledStart = ist('2026-11-07T23:00');
  return { scheduledStart, now: hoursBefore(scheduledStart, 2.5) };
};

describe('Ruleset 2026.11.14 (ADR-0034)', () => {
  it('is a new version, so bookings priced against 2026.10.01 keep their ruleset (Invariant 17)', () => {
    const card = videoCard();

    expect(card.version).toBe(VIDEO_RULESET_VERSION);
    expect(card.version).not.toBe(launch().version);
  });

  it('keeps every photography rate of the launch card unchanged', () => {
    const card = videoCard();
    const base = launch();

    expect(card.baseRates).toEqual(base.baseRates);
    expect(card.extensionRates).toEqual(base.extensionRates);
    expect(card.categoryUplifts).toEqual(base.categoryUplifts);
    expect(card.travelSlabs).toEqual(base.travelSlabs);
  });
});

describe('Videography per hour, by tier', () => {
  const cases: ReadonlyArray<readonly [PlanTier, number, bigint]> = [
    ['BASIC', 2, 400_000n],
    ['BASIC', 2.5, 500_000n],
    ['BASIC', 4, 800_000n],
    ['SEMI_PRO', 2, 600_000n],
    ['SEMI_PRO', 2.5, 750_000n],
    ['SEMI_PRO', 4, 1_200_000n],
    ['PROFESSIONAL', 2, 1_000_000n],
    ['PROFESSIONAL', 2.5, 1_250_000n],
    ['PROFESSIONAL', 4, 2_000_000n],
    ['EXPERT', 2, 1_000_000n],
    ['EXPERT', 3.5, 1_750_000n],
  ];

  it.each(cases)('%s × %s h → %s paise', (tier, hours, expected) => {
    const request = quoteRequest({ tier, hours, addons: [VIDEO] });

    const quote = quoteOf(computeQuote(request, videoCard()));

    expect(quote.addonsAmountPaise).toBe(expected);
    expect(quote.lines).toContainEqual(
      expect.objectContaining({ code: 'ADDON_VIDEOGRAPHER', amountPaise: expected }),
    );
  });

  it('shows the hourly video rate and the hours on the line', () => {
    const request = quoteRequest({ tier: 'SEMI_PRO', hours: 2, addons: [VIDEO] });

    const quote = quoteOf(computeQuote(request, videoCard()));

    expect(quote.lines).toContainEqual({
      code: 'ADDON_VIDEOGRAPHER',
      label: 'Videographer',
      detail: '₹3,000/hr × 2 hrs',
      amountPaise: 600_000n,
    });
  });

  it('charges the same video rate in a metro as in a Tier-1 city', () => {
    const surat = quoteOf(computeQuote(quoteRequest({ addons: [VIDEO] }), videoCard()));
    const mumbai = quoteOf(
      computeQuote(quoteRequest({ venue: MUMBAI, addons: [VIDEO] }), videoCard()),
    );

    expect(mumbai.addonsAmountPaise).toBe(surat.addonsAmountPaise);
  });

  it('follows the booking’s minimum: video cannot be booked for less than 2 hours', () => {
    const result = computeQuote(quoteRequest({ hours: 1.5, addons: [VIDEO] }), videoCard());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'BELOW_MINIMUM' });
  });

  it('is never multiplied by emergency, festival, night or weekend factors', () => {
    const request = quoteRequest({ ...everyFactor(), tier: 'SEMI_PRO', addons: [VIDEO] });

    const quote = quoteOf(computeQuote(request, videoCard()));

    expect(quote.addonsAmountPaise).toBe(600_000n);
  });

  it('leaves Signature quote-only', () => {
    const result = computeQuote(quoteRequest({ tier: 'SIGNATURE', addons: [VIDEO] }), videoCard());

    expect(result.kind).toBe('QUOTE_ONLY');
  });
});

describe('Reels: ₹3,000 each, ₹2,000 each for all of them from 5', () => {
  const cases: ReadonlyArray<readonly [number, bigint, string]> = [
    [1, 300_000n, '₹3,000'],
    [4, 1_200_000n, '₹3,000 × 4'],
    [5, 1_000_000n, '₹2,000 × 5'],
    [7, 1_400_000n, '₹2,000 × 7'],
  ];

  it.each(cases)('%s reel(s) → %s paise', (count, expected, detail) => {
    const request = quoteRequest({ addons: [VIDEO, reels(count)] });

    const quote = quoteOf(computeQuote(request, videoCard()));
    const reelLine = quote.lines.find((l) => l.code === 'ADDON_REELS');

    expect(reelLine?.amountPaise).toBe(expected);
    expect(reelLine?.label).toBe('Reels');
    if (count === 1) expect(reelLine?.detail).toBeUndefined();
    else expect(reelLine?.detail).toBe(detail);
  });

  it('makes 5 reels cheaper than 4', () => {
    const at = (count: number) =>
      quoteOf(computeQuote(quoteRequest({ addons: [VIDEO, reels(count)] }), videoCard()))
        .addonsAmountPaise;

    expect(at(5)).toBeLessThan(at(4));
  });

  it('is the same price on every tier and is not multiplied', () => {
    const basic = quoteOf(
      computeQuote(quoteRequest({ tier: 'BASIC', addons: [VIDEO, reels(5)] }), videoCard()),
    );
    const surged = quoteOf(
      computeQuote(
        quoteRequest({ ...everyFactor(), tier: 'BASIC', addons: [VIDEO, reels(5)] }),
        videoCard(),
      ),
    );

    expect(basic.addonsAmountPaise - 400_000n).toBe(1_000_000n);
    expect(surged.addonsAmountPaise).toBe(basic.addonsAmountPaise);
  });

  it('refuses more than 20 reels', () => {
    const result = computeQuote(quoteRequest({ addons: [VIDEO, reels(21)] }), videoCard());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_ADDON_QUANTITY' });
  });

  it('accepts exactly 20 reels', () => {
    const quote = quoteOf(computeQuote(quoteRequest({ addons: [VIDEO, reels(20)] }), videoCard()));

    expect(quote.lines.find((l) => l.code === 'ADDON_REELS')?.amountPaise).toBe(4_000_000n);
  });

  it('needs a videographer', () => {
    const result = computeQuote(quoteRequest({ addons: [reels(2)] }), videoCard());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_REQUIRES_ADDON' });
  });
});

describe('Rules every caller of the engine gets, not only checkout', () => {
  it('refuses the same add-on twice, so split lines cannot dodge the reel limit or price', () => {
    const result = computeQuote(quoteRequest({ addons: [VIDEO, reels(4), reels(4)] }), videoCard());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'DUPLICATE_ADDON' });
  });

  it('reports the first invalid add-on in request order, a missing videographer included', () => {
    const result = computeQuote(
      quoteRequest({ tier: 'BASIC', addons: [reels(2), { code: 'DRONE', quantity: 1 }] }),
      videoCard(),
    );

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_REQUIRES_ADDON' });
  });
});

describe('Raw footage: ₹1,000 flat per booking', () => {
  it.each([2, 4, 8])('costs ₹1,000 for a %s-hour booking', (hours) => {
    const request = quoteRequest({ hours, addons: [VIDEO, RAW] });

    const quote = quoteOf(computeQuote(request, videoCard()));

    expect(quote.lines).toContainEqual({
      code: 'ADDON_RAW_FOOTAGE',
      label: 'Raw footage',
      amountPaise: 100_000n,
    });
  });

  it('adds nothing when it is off', () => {
    const quote = quoteOf(computeQuote(quoteRequest({ addons: [VIDEO] }), videoCard()));

    expect(quote.lines.some((l) => l.code === 'ADDON_RAW_FOOTAGE')).toBe(false);
    expect(quote.addonsAmountPaise).toBe(1_000_000n);
  });

  it('is sold once per booking', () => {
    const result = computeQuote(
      quoteRequest({ addons: [VIDEO, { code: 'RAW_FOOTAGE', quantity: 2 }] }),
      videoCard(),
    );

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_ADDON_QUANTITY' });
  });

  it('needs a videographer', () => {
    const result = computeQuote(quoteRequest({ addons: [RAW] }), videoCard());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_REQUIRES_ADDON' });
  });
});

describe('The sample booking: Semi-Pro (Advanced) · Portrait · 2 h · 5 reels · raw footage', () => {
  const sample = (venue = quoteRequest().venue) =>
    quoteOf(
      computeQuote(
        quoteRequest({ tier: 'SEMI_PRO', venue, addons: [VIDEO, reels(5), RAW] }),
        videoCard(),
      ),
    );

  it('prices Surat (same state): base + video + reels + raw, then CGST + SGST', () => {
    const quote = sample();

    // base 275000 × 2 = 550000 · video 300000 × 2 = 600000 · reels 200000 × 5 · raw 100000
    expect(quote.baseAmountPaise).toBe(550_000n);
    expect(quote.addonsAmountPaise).toBe(1_700_000n);
    expect(quote.subtotalPaise).toBe(2_250_000n);
    expect(quote.gstAmountPaise).toBe(405_000n);
    expect(quote.gst).toMatchObject({ cgstPaise: 202_500n, sgstPaise: 202_500n, igstPaise: 0n });
    expect(quote.totalPaise).toBe(2_655_000n);
    expect(quote.advancePaise + quote.balancePaise).toBe(quote.totalPaise);
  });

  it('prices Mumbai (other state) with IGST on the video lines too', () => {
    const quote = sample(MUMBAI);

    // base 320000 × 2 = 640000; the video lines are the same everywhere
    expect(quote.subtotalPaise).toBe(2_340_000n);
    expect(quote.gst).toMatchObject({ cgstPaise: 0n, sgstPaise: 0n, igstPaise: 421_200n });
    expect(quote.totalPaise).toBe(2_761_200n);
  });

  it('reconciles: the money lines add up to the subtotal', () => {
    expect(sumLineAmounts(sample().lines)).toBe(sample().subtotalPaise);
  });

  it('pays the photographer the tier share of base + every video line (doc 05 step 12)', () => {
    // round(0.62 × 2250000) = 1395000, no travel
    expect(sample().expectedPayoutPaise).toBe(1_395_000n);
  });
});

describe('Quantity-tier add-on prices (the engine capability)', () => {
  /** A synthetic ruleset: BULK priced per tier and in general, with breaks at 3 and 10 units. */
  const bulk = (): Ruleset => {
    const card = launch();
    return {
      ...card,
      addons: [
        ...card.addons,
        {
          code: 'BULK',
          label: 'Bulk',
          minTier: null,
          requiresAirspaceCheck: false,
          maxQuantity: 50,
          requiresAddonCode: null,
        },
        {
          code: 'HOURLY_BULK',
          label: 'Hourly bulk',
          minTier: null,
          requiresAirspaceCheck: false,
          maxQuantity: 50,
          requiresAddonCode: null,
        },
      ],
      addonPrices: [
        ...card.addonPrices,
        {
          addonCode: 'BULK',
          tier: null,
          cityTier: null,
          minQuantity: 10,
          amountPaise: 700n,
          isPerHour: false,
          payoutShareBps: 6000,
        },
        {
          addonCode: 'BULK',
          tier: null,
          cityTier: null,
          minQuantity: 1,
          amountPaise: 1_000n,
          isPerHour: false,
          payoutShareBps: 6000,
        },
        {
          addonCode: 'BULK',
          tier: null,
          cityTier: null,
          minQuantity: 3,
          amountPaise: 900n,
          isPerHour: false,
          payoutShareBps: 6000,
        },
        {
          addonCode: 'BULK',
          tier: 'EXPERT',
          cityTier: null,
          minQuantity: 1,
          amountPaise: 1_500n,
          isPerHour: false,
          payoutShareBps: 6000,
        },
        {
          addonCode: 'HOURLY_BULK',
          tier: null,
          cityTier: null,
          minQuantity: 1,
          amountPaise: 33_333n,
          isPerHour: true,
          payoutShareBps: 6000,
        },
        {
          addonCode: 'HOURLY_BULK',
          tier: null,
          cityTier: null,
          minQuantity: 2,
          amountPaise: 33_331n,
          isPerHour: true,
          payoutShareBps: 6000,
        },
      ],
    };
  };
  const amount = (code: string, quantity: number, overrides = {}) =>
    quoteOf(computeQuote(quoteRequest({ addons: [{ code, quantity }], ...overrides }), bulk()))
      .addonsAmountPaise;

  it.each([
    [1, 1_000n],
    [2, 2_000n],
    [3, 2_700n],
    [9, 8_100n],
    [10, 7_000n],
    [11, 7_700n],
  ])('%s units take the highest break they reach, for every unit → %s', (quantity, expected) => {
    expect(amount('BULK', quantity)).toBe(expected);
  });

  it('lets a tier-specific row win over the general breaks', () => {
    expect(amount('BULK', 10, { tier: 'EXPERT' })).toBe(15_000n);
  });

  it('rounds a per-hour bulk line once, half-up, after multiplying every unit', () => {
    // 33331 × 5 half-hours × 2 / 2 = 166655 exactly; one unit: 33333 × 5 / 2 = 83332.5 → 83333
    expect(amount('HOURLY_BULK', 2, { hours: 2.5 })).toBe(166_655n);
    expect(amount('HOURLY_BULK', 1, { hours: 2.5 })).toBe(83_333n);
  });

  it('refuses a quantity no row covers', () => {
    const card = bulk();
    const noBase: Ruleset = {
      ...card,
      addonPrices: card.addonPrices.filter((p) => !(p.addonCode === 'BULK' && p.minQuantity === 1)),
    };

    const result = computeQuote(quoteRequest({ addons: [{ code: 'BULK', quantity: 2 }] }), noBase);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_NOT_PRICED' });
  });
});
