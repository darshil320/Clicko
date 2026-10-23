/**
 * Launch rate card — mirrors docs/clickco-05-pricing-engine.md §5 (ruleset 2026.10.01, ADR-0005
 * OD-02). Money is integer paise. `rate-card.test.ts` parses doc 05 and fails if these drift.
 * The pricing engine (apps/api) stays authoritative: the app always quotes before payment.
 */

export type BookableTier = 'BASIC' | 'SEMI_PRO' | 'PROFESSIONAL' | 'EXPERT';
export type PlanTier = BookableTier | 'SIGNATURE';
/** Only the city tiers of the three launch cities (Mumbai METRO; Surat, Vadodara TIER_1). */
export type LaunchCityTier = 'METRO' | 'TIER_1';
export type CategoryCode =
  | 'FOOD'
  | 'WEDDING'
  | 'PORTRAIT'
  | 'PRODUCT'
  | 'EVENT'
  | 'REAL_ESTATE'
  | 'CORPORATE';

export const BOOKABLE_TIERS: readonly BookableTier[] = [
  'BASIC',
  'SEMI_PRO',
  'PROFESSIONAL',
  'EXPERT',
];

/** `base_rates.rate_per_hour_paise` for the two launch city tiers. */
export const RATE_PER_HOUR_PAISE: Readonly<Record<BookableTier, Record<LaunchCityTier, bigint>>> = {
  BASIC: { METRO: 200_000n, TIER_1: 175_000n },
  SEMI_PRO: { METRO: 320_000n, TIER_1: 275_000n },
  PROFESSIONAL: { METRO: 500_000n, TIER_1: 425_000n },
  EXPERT: { METRO: 820_000n, TIER_1: 700_000n },
};

/** `category_uplifts`, in basis points (10000 = 1.00×). */
export const CATEGORY_UPLIFT_BPS: Readonly<Record<CategoryCode, number>> = {
  PORTRAIT: 10_000,
  EVENT: 10_000,
  FOOD: 11_500,
  PRODUCT: 11_000,
  REAL_ESTATE: 11_000,
  CORPORATE: 12_000,
  WEDDING: 12_500,
};

/** Portrait and Event carry no uplift, so they are the honest base for "from" prices. */
export const REFERENCE_UPLIFT_BPS = CATEGORY_UPLIFT_BPS.PORTRAIT;

export const MIN_HOURS = 2;
/** Signature is quote-only with a 4-hour minimum (v0.2 §10, ADR-0005 OD-04). */
export const SIGNATURE_MIN_HOURS = 4;
/** GST is exclusive (ADR-0005 OD-01): 18%, SAC 998383. */
export const GST_RATE_BPS = 1_800;
export const BPS_DENOMINATOR = 10_000;

export interface LeadTimeBand {
  readonly code: 'NONE' | 'NEXT_DAY' | 'SAME_DAY' | 'HOURS_3_8' | 'HOURS_UNDER_3';
  readonly leadTime: string;
  readonly multiplierBps: number;
  readonly promise: string;
  readonly payment: string;
  readonly ifUnfilled: string;
}

/**
 * `emergency_multipliers` (doc 05 §5) with the client-facing wording from v0.2 §8 and T&C §3.7.
 * T&C §3.7 is the stricter source: anything under 8 hours is best effort, never guaranteed.
 */
export const LEAD_TIME_BANDS: readonly LeadTimeBand[] = [
  {
    code: 'NONE',
    leadTime: 'More than 2 days ahead',
    multiplierBps: 10_000,
    promise: 'Confirmed',
    payment: '50% advance, balance after the shoot',
    ifUnfilled: 'Full refund',
  },
  {
    code: 'NEXT_DAY',
    leadTime: '24 to 48 hours ahead',
    multiplierBps: 12_000,
    promise: 'Confirmed',
    payment: '50% advance, balance after the shoot',
    ifUnfilled: 'Full refund',
  },
  {
    code: 'SAME_DAY',
    leadTime: '8 to 24 hours ahead',
    multiplierBps: 14_000,
    promise: 'High availability',
    payment: '100% at booking',
    ifUnfilled: 'Full refund, automatically',
  },
  {
    code: 'HOURS_3_8',
    leadTime: '3 to 8 hours ahead',
    multiplierBps: 18_000,
    promise: 'Best effort — not guaranteed',
    payment: '100% at booking',
    ifUnfilled: 'Full refund, automatically',
  },
  {
    code: 'HOURS_UNDER_3',
    leadTime: 'Under 3 hours',
    multiplierBps: 22_000,
    promise: 'Best effort — not guaranteed',
    payment: 'Authorised only; charged when a photographer accepts',
    ifUnfilled: 'Authorisation released in full — you are never charged',
  },
];

/** `time_multipliers` and the festival calendar, summarised for "what changes the price". */
export const PRICE_FACTORS = {
  weekendBps: 11_000,
  nightBps: 12_500,
  festivalMinBps: 11_500,
  festivalMaxBps: 12_500,
} as const;
