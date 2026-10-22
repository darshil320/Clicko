import { describe, expect, it } from 'vitest';
import {
  computeQuote,
  launchRuleset,
  type PricingRequest,
  type PricingResult,
  type PromoInput,
  priceExtension,
  type Quote,
  type ResolvedVenue,
  resolveEmergencyBand,
  toBreakdownJson,
} from './index';

const ruleset = launchRuleset('rs-launch', {
  surat: 'city-surat',
  mumbai: 'city-mumbai',
  vadodara: 'city-vadodara',
});

const SURAT: ResolvedVenue = {
  pincode: '395007',
  cityId: 'city-surat',
  cityTier: 'TIER_1',
  travelZone: 1,
  gstStateCode: '24',
};

const MUMBAI: ResolvedVenue = {
  pincode: '400001',
  cityId: 'city-mumbai',
  cityTier: 'METRO',
  travelZone: 0,
  gstStateCode: '27',
};

const FIRST200: PromoInput = {
  code: 'FIRST200',
  discountBps: null,
  discountFlatPaise: 20_000n,
  maxDiscountPaise: null,
  minBookingPaise: 0n,
  appliesToTiers: null,
  appliesToCityIds: null,
  firstBookingOnly: true,
  perUserCap: 1,
  validFrom: new Date('2026-11-01T00:00:00Z'),
  validTo: new Date('2027-12-31T00:00:00Z'),
  isActive: true,
  userRedemptions: 0,
  userBookingCount: 0,
};

const HOUR = 3_600_000;

function request(overrides: Partial<PricingRequest> = {}): PricingRequest {
  return {
    tier: 'PROFESSIONAL',
    categoryCode: 'FOOD',
    venue: SURAT,
    // Wednesday 2027-03-10 11:00 IST — outside every festival window.
    scheduledStart: new Date('2027-03-10T05:30:00Z'),
    hours: 2,
    now: new Date('2027-03-01T04:30:00Z'),
    addons: [],
    ...overrides,
  };
}

function quoteOf(result: PricingResult): Quote {
  if (result.kind !== 'QUOTE') throw new Error(`expected QUOTE, got ${JSON.stringify(result)}`);
  return result;
}

const docExample = (): PricingRequest =>
  request({
    addons: [{ code: 'DRONE', quantity: 1 }],
    travelDistanceMetres: 18_000,
    promo: FIRST200,
  });

describe('pricing engine smoke', () => {
  it('reproduces the doc 05 §7 money figures (no surge date)', () => {
    const q = quoteOf(computeQuote(docExample(), ruleset));
    expect(q.baseAmountPaise).toBe(977_500n);
    expect(q.addonsAmountPaise).toBe(450_000n);
    expect(q.travelAmountPaise).toBe(25_400n);
    expect(q.subtotalPaise).toBe(1_452_900n);
    expect(q.discountAmountPaise).toBe(20_000n);
    expect(q.taxablePaise).toBe(1_432_900n);
    expect(q.gst).toEqual({
      rateBps: 1800,
      sac: '998383',
      placeOfSupply: '24',
      cgstPaise: 128_961n,
      sgstPaise: 128_961n,
      igstPaise: 0n,
    });
    expect(q.totalPaise).toBe(1_690_822n);
    expect([q.advancePaise, q.balancePaise]).toEqual([845_411n, 845_411n]);
    expect(q.expectedPayoutPaise).toBe(881_900n);
    expect(q.airspaceCheckRequired).toBe(true);
    expect(q.quoteExpiresAt.getTime() - q.computedAt.getTime()).toBe(15 * 60_000);
    expect(q.lines).toEqual([
      {
        code: 'BASE',
        label: 'Professional · Food · 2 hours',
        detail: '₹4,250/hr × 2 hrs',
        amountPaise: 977_500n,
      },
      { code: 'CATEGORY', label: 'Food category', isFactor: true, factorBps: 11_500 },
      { code: 'ADDON_DRONE', label: 'Drone coverage', amountPaise: 450_000n },
      { code: 'TRAVEL', label: 'Travel (18 km)', detail: 'Zone 1', amountPaise: 25_400n },
      { code: 'DISCOUNT', label: 'FIRST200', amountPaise: -20_000n },
    ]);
    expect(computeQuote(docExample(), ruleset)).toEqual(q);
  });

  it('applies festival surge as MAX of overlapping rows, never to addons/travel', () => {
    const wedding = quoteOf(
      computeQuote(
        request({
          scheduledStart: new Date('2026-11-18T05:30:00Z'),
          now: new Date('2026-11-10T05:30:00Z'),
        }),
        ruleset,
      ),
    );
    expect(wedding.baseAmountPaise).toBe(1_124_125n); // 850000 × 1.15 × 1.15
    expect(wedding.travelAmountPaise).toBe(20_000n); // zone 1 flat, unmultiplied
    expect(wedding.isPeakSeason).toBe(true);
    expect(wedding.lines.find((l) => l.code === 'SURGE')).toEqual({
      code: 'SURGE',
      label: 'Wedding season 2026-27',
      isFactor: true,
      factorBps: 11_500,
    });
    const diwali = quoteOf(
      computeQuote(
        request({
          scheduledStart: new Date('2026-11-09T05:30:00Z'),
          now: new Date('2026-11-01T05:30:00Z'),
        }),
        ruleset,
      ),
    );
    expect(diwali.factors.surgeBps).toBe(12_500);
  });

  it('treats exactly 3.0 h lead as HOURS_3_8 and 2.999… h as HOURS_UNDER_3', () => {
    const now = new Date('2027-03-10T00:00:00Z');
    const at = (ms: number) => new Date(now.getTime() + ms);
    expect(resolveEmergencyBand(at(3 * HOUR), now)).toBe('HOURS_3_8');
    expect(resolveEmergencyBand(at(3 * HOUR - 1), now)).toBe('HOURS_UNDER_3');
    expect(resolveEmergencyBand(at(8 * HOUR), now)).toBe('SAME_DAY');
    expect(resolveEmergencyBand(at(24 * HOUR), now)).toBe('NEXT_DAY');
    expect(resolveEmergencyBand(at(48 * HOUR), now)).toBe('NONE');

    const exact = quoteOf(computeQuote(request({ now, scheduledStart: at(3 * HOUR) }), ruleset));
    expect(exact.emergencyBand).toBe('HOURS_3_8');
    expect([exact.advancePaise, exact.balancePaise]).toEqual([exact.totalPaise, 0n]);
    const under = quoteOf(
      computeQuote(request({ now, scheduledStart: at(3 * HOUR - 1) }), ruleset),
    );
    expect(under.factors.emergencyBps).toBe(22_000);
    expect([under.captureOnAcceptOnly, under.isGuaranteed, under.autoRefundMinutesBefore]).toEqual([
      true,
      false,
      90,
    ]);
  });

  it('judges night and weekend on the IST start time', () => {
    const base = { tier: 'BASIC', categoryCode: 'PORTRAIT' } as const;
    const night = quoteOf(
      computeQuote(request({ ...base, scheduledStart: new Date('2027-03-13T16:30:00Z') }), ruleset),
    ); // Sat 22:00 IST
    expect([night.factors.nightBps, night.factors.weekendBps]).toEqual([12_500, 11_000]);
    expect(night.baseAmountPaise).toBe(481_250n);
    const dusk = quoteOf(
      computeQuote(request({ ...base, scheduledStart: new Date('2027-03-13T16:29:00Z') }), ruleset),
    ); // Sat 21:59 IST
    expect(dusk.factors.nightBps).toBe(10_000);
    expect(dusk.baseAmountPaise).toBe(385_000n);
  });

  it('rejects in the binding validation order', () => {
    const code = (r: PricingResult) => (r.kind === 'REJECTED' ? r.code : r.kind);
    const now = request().now;
    expect(code(computeQuote(request({ scheduledStart: now }), ruleset))).toBe('START_IN_PAST');
    expect(code(computeQuote(request({ tier: 'SIGNATURE', hours: 1 }), ruleset))).toBe(
      'QUOTE_ONLY',
    );
    expect(code(computeQuote(request({ hours: 1.9 }), ruleset))).toBe('BELOW_MINIMUM');
    expect(code(computeQuote(request({ hours: 2.25 }), ruleset))).toBe('INVALID_INCREMENT');
    expect(code(computeQuote(request({ categoryCode: 'NOPE' }), ruleset))).toBe('UNKNOWN_CATEGORY');
    const basicDrone = request({ tier: 'BASIC', addons: [{ code: 'DRONE', quantity: 1 }] });
    expect(code(computeQuote(basicDrone, ruleset))).toBe('ADDON_TIER_INELIGIBLE');
    const used = request({ promo: { ...FIRST200, userBookingCount: 1 } });
    expect(code(computeQuote(used, ruleset))).toBe('PROMO_NOT_APPLICABLE');
  });

  it('charges IGST for an inter-state venue and omits a zero travel line', () => {
    const q = quoteOf(computeQuote(request({ venue: MUMBAI, categoryCode: 'PORTRAIT' }), ruleset));
    expect(q.baseAmountPaise).toBe(1_000_000n);
    expect(q.gst).toMatchObject({ placeOfSupply: '27', cgstPaise: 0n, sgstPaise: 0n });
    expect(q.gst.igstPaise).toBe(180_000n);
    expect(q.totalPaise).toBe(1_180_000n);
    expect(q.lines.some((l) => l.code === 'TRAVEL')).toBe(false);
  });

  it('renders the §7 breakdown JSON and round-trips it', () => {
    const json = toBreakdownJson(quoteOf(computeQuote(docExample(), ruleset)));
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
    expect(json).toMatchObject({
      currency: 'INR',
      pricesIncludeGst: false,
      subtotalPaise: 1_452_900,
      gst: { rateBps: 1800, cgstPaise: 128_961, sgstPaise: 128_961, igstPaise: 0 },
      totalPaise: 1_690_822,
      advancePaise: 845_411,
      balancePaise: 845_411,
      factorsApplied: {
        categoryUpliftBps: 11_500,
        emergencyBps: 10_000,
        surgeBps: 10_000,
        nightBps: 10_000,
        weekendBps: 10_000,
      },
      rulesetVersion: '2026.10.01',
      computedAt: '2027-03-01T04:30:00.000Z',
    });
    expect((json.lines as unknown[])[4]).toEqual({
      code: 'DISCOUNT',
      label: 'FIRST200',
      amountPaise: -20_000,
    });
  });

  it('prices extensions as base hourly × category uplift only', () => {
    expect(priceExtension('PROFESSIONAL', 'TIER_1', 'FOOD', ruleset)).toEqual({
      hourlyPaise: 488_750n,
      waitingHourlyPaise: 293_250n,
      waitingGraceMinutes: 15,
    });
    expect(() => priceExtension('SIGNATURE', 'TIER_1', 'FOOD', ruleset)).toThrow();
  });
});
