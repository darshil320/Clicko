/**
 * Shared fixtures for the pricing-engine tests. Test support only: no pricing logic lives here.
 *
 * Every instant is built from an explicit IST wall-clock string via `ist()`, except where a test
 * is about the timezone conversion itself, in which case it spells out the UTC instant.
 */
import type { CityTier, PlanTier } from '@clickco/contracts';
import {
  launchRuleset,
  type PricingRequest,
  type PricingResult,
  type PromoInput,
  type Quote,
  type QuoteLine,
  type ResolvedVenue,
  type Ruleset,
} from '../index';

export const CITY = {
  surat: 'city-surat',
  mumbai: 'city-mumbai',
  vadodara: 'city-vadodara',
} as const;

export const RULESET_ID = 'ruleset-launch-2026-11-01';

/** A fresh launch ruleset (doc 05 §5 + ADR-0005) per call, so no test can leak state into another. */
export function launch(): Ruleset {
  return launchRuleset(RULESET_ID, CITY);
}

/** Surat: TIER_1, Gujarat (GST state 24 = Clickco's own state → CGST + SGST). */
export const SURAT: ResolvedVenue = {
  pincode: '395007',
  cityId: CITY.surat,
  cityTier: 'TIER_1',
  travelZone: 0,
  gstStateCode: '24',
};

/** Mumbai: METRO, Maharashtra (GST state 27 → IGST). */
export const MUMBAI: ResolvedVenue = {
  pincode: '400001',
  cityId: CITY.mumbai,
  cityTier: 'METRO',
  travelZone: 0,
  gstStateCode: '27',
};

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

/** An IST wall-clock time 'YYYY-MM-DDTHH:mm' as an absolute instant (IST = UTC+05:30, no DST). */
export function ist(local: string): Date {
  return new Date(`${local}:00+05:30`);
}

export function hoursBefore(instant: Date, hours: number): Date {
  return new Date(instant.getTime() - hours * HOUR_MS);
}

/**
 * Lead time in thousandths of an hour (1 millihour = 3.6 s). Kept integral so no floating-point
 * error can creep into a boundary test: 2.999 h = 2999 millihours = 10 796 400 ms exactly.
 */
export function millihoursBefore(instant: Date, millihours: number): Date {
  return new Date(instant.getTime() - millihours * 3_600);
}

/** Tuesday 16 Mar 2027, 11:00 IST: weekday, daytime, outside every festival in the launch calendar. */
export const NEUTRAL_START = ist('2027-03-16T11:00');

/** One week before NEUTRAL_START, so the emergency band is NONE. */
export const NEUTRAL_NOW = hoursBefore(NEUTRAL_START, 7 * 24);

/** A start instant booked one week ahead, so the emergency band is NONE. */
export function weekAhead(scheduledStart: Date): Pick<PricingRequest, 'scheduledStart' | 'now'> {
  return { scheduledStart, now: hoursBefore(scheduledStart, 7 * 24) };
}

/** A start at an IST wall-clock time, booked one week ahead. */
export function startingAt(local: string): Pick<PricingRequest, 'scheduledStart' | 'now'> {
  return weekAhead(ist(local));
}

/**
 * Baseline request: Professional · Portrait (1.00×) · Surat (TIER_1, zone 0) · 2 h · neutral
 * Tuesday 11:00 IST a week ahead · no addons, no distance, no promo.
 * Base = 425000 × 4 half-hours / 2 = 850000 paise, every factor 1.00×.
 */
export function quoteRequest(overrides: Partial<PricingRequest> = {}): PricingRequest {
  return {
    tier: 'PROFESSIONAL',
    categoryCode: 'PORTRAIT',
    venue: SURAT,
    scheduledStart: NEUTRAL_START,
    hours: 2,
    now: NEUTRAL_NOW,
    addons: [],
    ...overrides,
  };
}

/** A valid, active, unrestricted flat ₹200 promo. Override one field to break exactly one rule. */
export function promo(overrides: Partial<PromoInput> = {}): PromoInput {
  return {
    code: 'FIRST200',
    discountBps: null,
    discountFlatPaise: 20_000n,
    maxDiscountPaise: null,
    minBookingPaise: 0n,
    appliesToTiers: null,
    appliesToCityIds: null,
    firstBookingOnly: false,
    perUserCap: 1,
    validFrom: ist('2026-01-01T00:00'),
    validTo: ist('2028-01-01T00:00'),
    isActive: true,
    userRedemptions: 0,
    userBookingCount: 0,
    ...overrides,
  };
}

/**
 * The doc 05 §7 worked example: Professional · Food · Surat · 2 h · Tuesday 17 Nov 2026 15:00 IST
 * (inside wedding season, after Diwali week) · quoted 13 days ahead · DRONE · 18 km · flat ₹200 off.
 * The hand arithmetic lives next to its assertions in compute-quote.test.ts.
 */
export function workedExampleRequest(): PricingRequest {
  return quoteRequest({
    categoryCode: 'FOOD',
    scheduledStart: new Date('2026-11-17T09:30:00.000Z'),
    now: new Date('2026-11-04T11:22:31.442Z'),
    addons: [{ code: 'DRONE', quantity: 1 }],
    travelDistanceMetres: 18_000,
    promo: promo({ code: 'FIRST200', discountFlatPaise: 20_000n }),
  });
}

/** Narrow a result to a priced quote, failing loudly with the actual result otherwise. */
export function quoteOf(result: PricingResult): Quote {
  if (result.kind !== 'QUOTE') {
    throw new Error(`expected a QUOTE, got ${JSON.stringify(result)}`);
  }
  return result;
}

export function withBaseRate(
  ruleset: Ruleset,
  tier: PlanTier,
  cityTier: CityTier,
  ratePerHourPaise: bigint,
): Ruleset {
  return {
    ...ruleset,
    baseRates: ruleset.baseRates.map((r) =>
      r.tier === tier && r.cityTier === cityTier ? { ...r, ratePerHourPaise } : r,
    ),
  };
}

export function withoutBaseRate(ruleset: Ruleset, tier: PlanTier, cityTier: CityTier): Ruleset {
  return {
    ...ruleset,
    baseRates: ruleset.baseRates.filter((r) => !(r.tier === tier && r.cityTier === cityTier)),
  };
}

/** Σ amountPaise over the money lines (factor lines carry no amount). */
export function sumLineAmounts(lines: readonly QuoteLine[]): bigint {
  return lines.reduce((sum, line) => sum + (line.amountPaise ?? 0n), 0n);
}

/** Recursively freeze a value so any in-place mutation by the engine throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** True if a bigint appears anywhere inside the value. */
export function containsBigint(value: unknown): boolean {
  if (typeof value === 'bigint') {
    return true;
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some(containsBigint);
  }
  return false;
}
