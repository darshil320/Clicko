/**
 * Pricing engine — doc 05 §10 test matrix, part 3 of 4:
 *   Travel · Addons · Promo · Expected payout.
 *
 * Travel and addons are layered on top of the multiplied base and are never multiplied by any
 * factor. Baseline: Professional · Portrait · Surat (TIER_1, Gujarat) · 2 h → base 850000 paise.
 * Launch travel slabs (every city tier): zone 0 (0, 15000] m free · zone 1 (15000, 40000] m
 * ₹200 + ₹18/km beyond 15 km · zone 2 (40000, ∞) m ₹800 + ₹22/km beyond 40 km + ₹1,500 overnight.
 */
import { describe, expect, it } from 'vitest';
import { computeQuote } from '../index';
import {
  CITY,
  hoursBefore,
  ist,
  launch,
  MUMBAI,
  NEUTRAL_NOW,
  promo,
  quoteOf,
  quoteRequest,
  SURAT,
  startingAt,
  withBaseRate,
} from './fixtures';

/** Diwali Saturday 23:00 IST booked 1 h ahead: HOURS_UNDER_3 × Diwali × night × weekend all apply. */
const everyFactor = () => {
  const scheduledStart = ist('2026-11-07T23:00');
  return { scheduledStart, now: hoursBefore(scheduledStart, 1) };
};

describe('Travel', () => {
  it('charges nothing for 0 km', () => {
    const request = quoteRequest({ travelDistanceMetres: 0 });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ travelZone: 0, travelAmountPaise: 0n });
  });

  it('keeps exactly 15.00 km in zone 0 and charges nothing', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_000 });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ travelZone: 0, travelAmountPaise: 0n });
  });

  it('moves 15.01 km into zone 1 and charges 20018 paise', () => {
    const request = quoteRequest({ travelDistanceMetres: 15_010 });

    const quote = quoteOf(computeQuote(request, launch()));

    // 20000 flat + 1800 × 10 m / 1000 = 20000 + 18
    expect(quote).toMatchObject({ travelZone: 1, travelAmountPaise: 20_018n });
  });

  it('charges 18 km as the ₹200 flat plus 3 km at ₹18: 25400 paise', () => {
    const request = quoteRequest({ travelDistanceMetres: 18_000 });

    const quote = quoteOf(computeQuote(request, launch()));

    // 20000 + 1800 × 3000 / 1000 = 20000 + 5400
    expect(quote.travelAmountPaise).toBe(25_400n);
  });

  it('keeps exactly 40.00 km in zone 1 and charges 65000 paise', () => {
    const request = quoteRequest({ travelDistanceMetres: 40_000 });

    const quote = quoteOf(computeQuote(request, launch()));

    // 20000 + 1800 × 25000 / 1000 = 20000 + 45000
    expect(quote).toMatchObject({ travelZone: 1, travelAmountPaise: 65_000n });
  });

  it('moves 40.01 km into zone 2 and adds the overnight charge: 230022 paise', () => {
    const request = quoteRequest({ travelDistanceMetres: 40_010 });

    const quote = quoteOf(computeQuote(request, launch()));

    // 80000 flat + 2200 × 10 / 1000 (= 22) + 150000 overnight
    expect(quote).toMatchObject({ travelZone: 2, travelAmountPaise: 230_022n });
  });

  it('fails loudly with NO_TRAVEL_SLAB when the venue city tier has no slabs', () => {
    const base = launch();
    const ruleset = {
      ...base,
      travelSlabs: base.travelSlabs.filter((s) => s.cityTier !== 'TIER_1'),
    };
    const request = quoteRequest({ travelDistanceMetres: 18_000 });

    const result = computeQuote(request, ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'NO_TRAVEL_SLAB' });
  });

  it('fails loudly with NO_TRAVEL_SLAB when no slab covers the distance', () => {
    const base = launch();
    const ruleset = {
      ...base,
      travelSlabs: base.travelSlabs.filter((s) => !(s.cityTier === 'TIER_1' && s.zone === 2)),
    };
    const request = quoteRequest({ travelDistanceMetres: 50_000 });

    const result = computeQuote(request, ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'NO_TRAVEL_SLAB' });
  });

  it("charges the zone 1 flat when no distance is given and the venue's zone is 1", () => {
    const request = quoteRequest({ venue: { ...SURAT, travelZone: 1 } });

    const quote = quoteOf(computeQuote(request, launch()));

    // distance taken as the slab's fromMetres (15000): 20000 + 0
    expect(quote).toMatchObject({ travelZone: 1, travelAmountPaise: 20_000n });
  });

  it("charges the zone 2 flat plus overnight when no distance is given and the venue's zone is 2", () => {
    const request = quoteRequest({ venue: { ...SURAT, travelZone: 2 } });

    const quote = quoteOf(computeQuote(request, launch()));

    // 80000 + 0 + 150000
    expect(quote).toMatchObject({ travelZone: 2, travelAmountPaise: 230_000n });
  });

  it("derives the zone from a supplied distance, overriding the venue's zone", () => {
    const request = quoteRequest({
      venue: { ...SURAT, travelZone: 0 },
      travelDistanceMetres: 18_000,
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.travelZone).toBe(1);
  });

  it("looks the slab up by the venue's city tier", () => {
    const base = launch();
    const ruleset = {
      ...base,
      travelSlabs: base.travelSlabs.map((s) =>
        s.cityTier === 'METRO' && s.zone === 1 ? { ...s, flatPaise: 30_000n } : s,
      ),
    };
    const request = quoteRequest({ venue: MUMBAI, travelDistanceMetres: 18_000 });

    const quote = quoteOf(computeQuote(request, ruleset));

    // 30000 + 1800 × 3000 / 1000
    expect(quote.travelAmountPaise).toBe(35_400n);
  });

  it('rounds the per-metre charge half-up: 1 m at ₹25/km is 2.5 paise, charged as 3', () => {
    const base = launch();
    const ruleset = {
      ...base,
      travelSlabs: base.travelSlabs.map((s) =>
        s.cityTier === 'TIER_1' && s.zone === 1 ? { ...s, perKmPaise: 2_500n } : s,
      ),
    };
    const request = quoteRequest({ travelDistanceMetres: 15_001 });

    const quote = quoteOf(computeQuote(request, ruleset));

    // 20000 + roundHalfUp(2500 × 1, 1000) = 20000 + 3
    expect(quote.travelAmountPaise).toBe(20_003n);
  });

  it('never multiplies travel by emergency, surge, night or weekend', () => {
    const request = quoteRequest({ ...everyFactor(), travelDistanceMetres: 18_000 });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.travelAmountPaise).toBe(25_400n);
  });
});

describe('Addons', () => {
  it('charges a per-booking addon once, whatever the hours', () => {
    const request = quoteRequest({ hours: 3, addons: [{ code: 'DRONE', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  it('charges a per-hour addon for every hour booked', () => {
    const request = quoteRequest({ hours: 2.5, addons: [{ code: 'SECOND_SHOOTER', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    // 150000 × 5 half-hours / 2
    expect(quote.addonsAmountPaise).toBe(375_000n);
  });

  it('multiplies a per-booking addon by its quantity', () => {
    const request = quoteRequest({ addons: [{ code: 'LIGHTING_KIT', quantity: 2 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    // 150000 × 2
    expect(quote.addonsAmountPaise).toBe(300_000n);
  });

  it('multiplies a per-hour addon by both hours and quantity', () => {
    const request = quoteRequest({ hours: 2.5, addons: [{ code: 'SECOND_SHOOTER', quantity: 2 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    // 150000 × 5 × 2 / 2
    expect(quote.addonsAmountPaise).toBe(750_000n);
  });

  it('sums several addons into the addons amount', () => {
    const addons = [
      { code: 'DRONE', quantity: 1 },
      { code: 'LIGHTING_KIT', quantity: 1 },
      { code: 'RUSH_24H', quantity: 1 },
    ];

    const quote = quoteOf(computeQuote(quoteRequest({ addons }), launch()));

    // 450000 + 150000 + 250000
    expect(quote.addonsAmountPaise).toBe(850_000n);
  });

  it('emits an ADDON_<code> line carrying the addon amount', () => {
    const request = quoteRequest({ addons: [{ code: 'DRONE', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.lines).toContainEqual(
      expect.objectContaining({ code: 'ADDON_DRONE', amountPaise: 450_000n }),
    );
  });

  it('rejects a drone on a Semi-Pro booking as below its minimum tier', () => {
    const request = quoteRequest({ tier: 'SEMI_PRO', addons: [{ code: 'DRONE', quantity: 1 }] });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_TIER_INELIGIBLE' });
  });

  it('rejects a second shooter on a Basic booking as below its minimum tier', () => {
    const request = quoteRequest({
      tier: 'BASIC',
      addons: [{ code: 'SECOND_SHOOTER', quantity: 1 }],
    });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_TIER_INELIGIBLE' });
  });

  it('accepts a second shooter on Semi-Pro, exactly its minimum tier', () => {
    const request = quoteRequest({
      tier: 'SEMI_PRO',
      addons: [{ code: 'SECOND_SHOOTER', quantity: 1 }],
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // 150000 × 4 / 2
    expect(quote.addonsAmountPaise).toBe(300_000n);
  });

  it('accepts a drone on Expert, above its minimum tier', () => {
    const request = quoteRequest({ tier: 'EXPERT', addons: [{ code: 'DRONE', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  it('flags the airspace check for a drone without blocking the quote', () => {
    const request = quoteRequest({ addons: [{ code: 'DRONE', quantity: 1 }] });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'QUOTE', airspaceCheckRequired: true });
  });

  it('does not flag the airspace check when no addon needs one', () => {
    const request = quoteRequest({ addons: [{ code: 'LIGHTING_KIT', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.airspaceCheckRequired).toBe(false);
  });

  it('rejects an addon code the ruleset does not know as ADDON_NOT_PRICED', () => {
    const request = quoteRequest({ addons: [{ code: 'JETPACK', quantity: 1 }] });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_NOT_PRICED' });
  });

  it('rejects a catalogued addon that has no price row as ADDON_NOT_PRICED', () => {
    const base = launch();
    const ruleset = {
      ...base,
      addonPrices: base.addonPrices.filter((p) => p.addonCode !== 'DRONE'),
    };
    const request = quoteRequest({ addons: [{ code: 'DRONE', quantity: 1 }] });

    const result = computeQuote(request, ruleset);

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'ADDON_NOT_PRICED' });
  });

  it('rejects an addon quantity of 0', () => {
    const request = quoteRequest({ addons: [{ code: 'LIGHTING_KIT', quantity: 0 }] });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_ADDON_QUANTITY' });
  });

  it('rejects a fractional addon quantity', () => {
    const request = quoteRequest({ addons: [{ code: 'LIGHTING_KIT', quantity: 1.5 }] });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'INVALID_ADDON_QUANTITY' });
  });

  it('does not multiply addons by festival surge', () => {
    const request = quoteRequest({
      ...startingAt('2026-11-09T11:00'),
      addons: [{ code: 'DRONE', quantity: 1 }],
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  it('does not multiply addons by the emergency multiplier', () => {
    const request = quoteRequest({
      now: hoursBefore(quoteRequest().scheduledStart, 1),
      addons: [{ code: 'DRONE', quantity: 1 }],
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  it('does not multiply addons by night, weekend or category uplift', () => {
    const request = quoteRequest({
      ...startingAt('2027-03-20T23:00'),
      categoryCode: 'WEDDING',
      addons: [{ code: 'DRONE', quantity: 1 }],
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.addonsAmountPaise).toBe(450_000n);
  });

  describe('price lookup, most specific row first', () => {
    // Rows deliberately listed least-specific first so "first match wins" would fail.
    const rulesetWithTieredDronePrices = () => {
      const base = launch();
      const drone = { addonCode: 'DRONE', isPerHour: false, payoutShareBps: 6000 };
      return {
        ...base,
        addonPrices: [
          ...base.addonPrices.filter((p) => p.addonCode !== 'DRONE'),
          { ...drone, tier: null, cityTier: null, amountPaise: 450_000n },
          { ...drone, tier: 'PROFESSIONAL' as const, cityTier: null, amountPaise: 400_000n },
          {
            ...drone,
            tier: 'PROFESSIONAL' as const,
            cityTier: 'TIER_1' as const,
            amountPaise: 350_000n,
          },
        ],
      };
    };

    it('uses the (tier, city tier) price when one exists', () => {
      const request = quoteRequest({ venue: SURAT, addons: [{ code: 'DRONE', quantity: 1 }] });

      const quote = quoteOf(computeQuote(request, rulesetWithTieredDronePrices()));

      expect(quote.addonsAmountPaise).toBe(350_000n);
    });

    it('falls back to the (tier, any city tier) price', () => {
      const request = quoteRequest({ venue: MUMBAI, addons: [{ code: 'DRONE', quantity: 1 }] });

      const quote = quoteOf(computeQuote(request, rulesetWithTieredDronePrices()));

      expect(quote.addonsAmountPaise).toBe(400_000n);
    });

    it('falls back to the (any tier, any city tier) price', () => {
      const request = quoteRequest({ tier: 'EXPERT', addons: [{ code: 'DRONE', quantity: 1 }] });

      const quote = quoteOf(computeQuote(request, rulesetWithTieredDronePrices()));

      expect(quote.addonsAmountPaise).toBe(450_000n);
    });
  });
});

describe('Promo', () => {
  it('takes a percentage discount off the subtotal', () => {
    const request = quoteRequest({ promo: promo({ discountBps: 1000, discountFlatPaise: null }) });

    const quote = quoteOf(computeQuote(request, launch()));

    // 850000 × 1000 / 10000
    expect(quote.discountAmountPaise).toBe(85_000n);
  });

  it('takes a flat discount off the subtotal', () => {
    const request = quoteRequest({ promo: promo({ discountFlatPaise: 20_000n }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('applies the discount before GST', () => {
    const request = quoteRequest({ promo: promo({ discountBps: 1000, discountFlatPaise: null }) });

    const quote = quoteOf(computeQuote(request, launch()));

    // taxable 850000 − 85000 = 765000; GST 137700; total 902700
    expect(quote).toMatchObject({
      taxablePaise: 765_000n,
      gstAmountPaise: 137_700n,
      totalPaise: 902_700n,
    });
  });

  it('rounds a percentage discount half-up to the paise', () => {
    const request = quoteRequest({
      travelDistanceMetres: 15_010,
      promo: promo({ discountBps: 2500, discountFlatPaise: null }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // subtotal 850000 + 20018 = 870018; × 25% = 217504.5 → 217505
    expect(quote.discountAmountPaise).toBe(217_505n);
  });

  it('caps a percentage discount at the maximum discount', () => {
    const request = quoteRequest({
      promo: promo({ discountBps: 5000, discountFlatPaise: null, maxDiscountPaise: 100_000n }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // 50% of 850000 = 425000, capped at 100000
    expect(quote.discountAmountPaise).toBe(100_000n);
  });

  it('caps a flat discount at the maximum discount', () => {
    const request = quoteRequest({
      promo: promo({ discountFlatPaise: 30_000n, maxDiscountPaise: 20_000n }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('never discounts more than the subtotal', () => {
    const request = quoteRequest({ promo: promo({ discountFlatPaise: 1_000_000n }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(850_000n);
  });

  it('never lets a discount make the taxable amount negative', () => {
    const request = quoteRequest({ promo: promo({ discountFlatPaise: 1_000_000n }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote).toMatchObject({ taxablePaise: 0n, totalPaise: 0n });
  });

  it('rejects a code already redeemed up to its per-user cap', () => {
    const request = quoteRequest({ promo: promo({ perUserCap: 1, userRedemptions: 1 }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_USAGE_EXCEEDED' });
  });

  it('accepts a code redeemed one time fewer than its per-user cap', () => {
    const request = quoteRequest({ promo: promo({ perUserCap: 2, userRedemptions: 1 }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('rejects an expired code when now equals validTo', () => {
    const request = quoteRequest({ promo: promo({ validTo: NEUTRAL_NOW }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_EXPIRED' });
  });

  it('accepts a code one millisecond before validTo', () => {
    const request = quoteRequest({
      promo: promo({ validTo: new Date(NEUTRAL_NOW.getTime() + 1) }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('rejects a code used one millisecond before validFrom', () => {
    const request = quoteRequest({
      promo: promo({ validFrom: new Date(NEUTRAL_NOW.getTime() + 1) }),
    });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_EXPIRED' });
  });

  it('accepts a code exactly at validFrom', () => {
    const request = quoteRequest({ promo: promo({ validFrom: NEUTRAL_NOW }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('rejects an inactive code', () => {
    const request = quoteRequest({ promo: promo({ isActive: false }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_INACTIVE' });
  });

  it('rejects a code restricted to other tiers', () => {
    const request = quoteRequest({ promo: promo({ appliesToTiers: ['BASIC', 'SEMI_PRO'] }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_NOT_APPLICABLE' });
  });

  it('rejects a code restricted to other cities', () => {
    const request = quoteRequest({ promo: promo({ appliesToCityIds: [CITY.mumbai] }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_NOT_APPLICABLE' });
  });

  it("accepts a code whose tier and city lists include the booking's", () => {
    const request = quoteRequest({
      promo: promo({ appliesToTiers: ['PROFESSIONAL'], appliesToCityIds: [CITY.surat] }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('rejects a first-booking-only code for a user who already has a booking', () => {
    const request = quoteRequest({ promo: promo({ firstBookingOnly: true, userBookingCount: 1 }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_NOT_APPLICABLE' });
  });

  it('accepts a first-booking-only code for a user with no bookings', () => {
    const request = quoteRequest({ promo: promo({ firstBookingOnly: true, userBookingCount: 0 }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('rejects a subtotal one paise under the minimum booking value', () => {
    const request = quoteRequest({ promo: promo({ minBookingPaise: 850_001n }) });

    const result = computeQuote(request, launch());

    expect(result).toMatchObject({ kind: 'REJECTED', code: 'PROMO_MIN_NOT_MET' });
  });

  it('accepts a subtotal exactly at the minimum booking value', () => {
    const request = quoteRequest({ promo: promo({ minBookingPaise: 850_000n }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('judges the minimum booking value on a subtotal that includes addons', () => {
    const request = quoteRequest({
      addons: [{ code: 'DRONE', quantity: 1 }],
      promo: promo({ minBookingPaise: 1_300_000n }),
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // subtotal 850000 + 450000 = 1300000 ≥ 1300000
    expect(quote.discountAmountPaise).toBe(20_000n);
  });

  it('records the applied promo code on the quote', () => {
    const request = quoteRequest({ promo: promo({ code: 'DIWALI10' }) });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.promoCode).toBe('DIWALI10');
  });

  it('records no promo code and no discount when none is supplied', () => {
    const quote = quoteOf(computeQuote(quoteRequest(), launch()));

    expect(quote).toMatchObject({ promoCode: null, discountAmountPaise: 0n });
  });
});

describe('Expected payout', () => {
  it('pays the tier share of base plus addons, and passes travel through at 100%', () => {
    const request = quoteRequest({
      addons: [{ code: 'DRONE', quantity: 1 }],
      travelDistanceMetres: 18_000,
    });

    const quote = quoteOf(computeQuote(request, launch()));

    // (850000 + 450000) × 6000 / 10000 = 780000; + 25400 travel
    expect(quote.expectedPayoutPaise).toBe(805_400n);
  });

  it("applies the tier share to addons, not the addon's own payout share", () => {
    const request = quoteRequest({ addons: [{ code: 'SECOND_SHOOTER', quantity: 1 }] });

    const quote = quoteOf(computeQuote(request, launch()));

    // (850000 + 300000) × 0.60 = 690000.  Addon's own 62% would give 510000 + 186000 = 696000.
    expect(quote.expectedPayoutPaise).toBe(690_000n);
  });

  it('ignores the promo discount when computing the payout', () => {
    const request = quoteRequest({ promo: promo({ discountFlatPaise: 20_000n }) });

    const quote = quoteOf(computeQuote(request, launch()));

    // 850000 × 0.60
    expect(quote.expectedPayoutPaise).toBe(510_000n);
  });

  it("records the payout share from the tier's base-rate row", () => {
    const request = quoteRequest({ tier: 'BASIC' });

    const quote = quoteOf(computeQuote(request, launch()));

    expect(quote.payoutShareBps).toBe(6200);
  });

  it('rounds the payout half-up to the paise', () => {
    const ruleset = withBaseRate(launch(), 'BASIC', 'TIER_1', 175_010n);
    const request = quoteRequest({ tier: 'BASIC', hours: 2.5 });

    const quote = quoteOf(computeQuote(request, ruleset));

    // base 175010 × 5 / 2 = 437525; × 6200 / 10000 = 271265.5 → 271266
    expect(quote.expectedPayoutPaise).toBe(271_266n);
  });
});
