/**
 * Pricing engine types. The engine is a PURE function of (request, ruleset):
 * no I/O, no wall clock (`now` is an input), integer paise and basis points only.
 * Spec: docs/clickco-05-pricing-engine.md. Invariants: docs/DOMAIN.md §5.
 */
import type { CityTier, EmergencyBand, PlanTier } from '@clickco/contracts';

export const TIER_ORDER: readonly PlanTier[] = [
  'BASIC',
  'SEMI_PRO',
  'PROFESSIONAL',
  'EXPERT',
  'SIGNATURE',
];

/** Clickco's GST registration state (Gujarat). Same-state venue → CGST+SGST, else IGST. */
export const CLICKCO_GST_STATE_CODE = '24';

export interface BaseRateRule {
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  readonly ratePerHourPaise: bigint;
  readonly payoutShareBps: number;
  readonly isQuoteOnly: boolean;
}

export interface CategoryUpliftRule {
  readonly categoryCode: string;
  /** null = applies to every tier; a tier-specific row wins over it. */
  readonly tier: PlanTier | null;
  readonly multiplierBps: number;
}

export interface EmergencyRule {
  readonly band: EmergencyBand;
  readonly multiplierBps: number;
  readonly captureOnAcceptOnly: boolean;
  readonly isGuaranteed: boolean;
  readonly autoRefundMinutesBefore: number | null;
}

export interface NightRule {
  /** Minutes after local midnight. Inclusive start, exclusive end; may wrap midnight (22:00 → 06:00). */
  readonly windowStartMinute: number;
  readonly windowEndMinute: number;
  readonly multiplierBps: number;
}

export interface WeekendRule {
  /** ISO weekday numbers: 6 = Saturday, 7 = Sunday. */
  readonly isoDays: readonly number[];
  readonly multiplierBps: number;
}

export interface FestivalRule {
  readonly label: string;
  /** Inclusive local (IST) dates, YYYY-MM-DD. */
  readonly dateFrom: string;
  readonly dateTo: string;
  /** null = every city. */
  readonly cityId: string | null;
  readonly multiplierBps: number;
  readonly isPeakSeason: boolean;
}

export interface TravelSlabRule {
  readonly cityTier: CityTier;
  readonly zone: 0 | 1 | 2;
  /** Distances in metres (integers): 15 km = 15000. toMetres null = unbounded. */
  readonly fromMetres: number;
  readonly toMetres: number | null;
  readonly flatPaise: bigint;
  /** Charged per km beyond fromMetres, pro-rated per metre. */
  readonly perKmPaise: bigint;
  readonly overnightPaise: bigint;
}

export interface AddonRule {
  readonly code: string;
  readonly label: string;
  readonly minTier: PlanTier | null;
  readonly requiresAirspaceCheck: boolean;
}

export interface AddonPriceRule {
  readonly addonCode: string;
  /** null = any tier / any city tier. Most specific match wins: (tier, cityTier) → (tier, null) → (null, null). */
  readonly tier: PlanTier | null;
  readonly cityTier: CityTier | null;
  readonly amountPaise: bigint;
  readonly isPerHour: boolean;
  /** Mirrors addon_prices.payout_share_bps. NOT used by the v1 engine: doc 05 step 12 applies the tier share to base + addons. */
  readonly payoutShareBps: number;
}

export interface ExtensionRateRule {
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  /** Base hourly before category uplift (no surge/emergency/night/weekend, ever). */
  readonly hourlyPaise: bigint;
  readonly waitingGraceMinutes: number;
  /** Before category uplift. 60% of hourlyPaise in the launch ruleset. */
  readonly waitingHourlyPaise: bigint;
}

export interface DeliverableRule {
  readonly tier: PlanTier;
  readonly minHalfHours: number;
  readonly isInstantBookable: boolean;
}

export interface Ruleset {
  readonly id: string;
  readonly version: string;
  readonly pricesIncludeGst: boolean;
  readonly gstRateBps: number;
  readonly sacCode: string;
  readonly baseRates: readonly BaseRateRule[];
  readonly categoryUplifts: readonly CategoryUpliftRule[];
  readonly emergency: readonly EmergencyRule[];
  readonly night: NightRule | null;
  readonly weekend: WeekendRule | null;
  readonly festivals: readonly FestivalRule[];
  readonly travelSlabs: readonly TravelSlabRule[];
  readonly addons: readonly AddonRule[];
  readonly addonPrices: readonly AddonPriceRule[];
  readonly extensionRates: readonly ExtensionRateRule[];
  readonly deliverables: readonly DeliverableRule[];
}

/** The venue, already resolved through the serviceability gate (LIVE or PILOT only). */
export interface ResolvedVenue {
  readonly pincode: string;
  readonly cityId: string;
  readonly cityTier: CityTier;
  /** Zone from serviceable_areas; used only when no distance is supplied. */
  readonly travelZone: 0 | 1 | 2;
  /** 2-digit GST state code of the venue (place of supply). Gujarat = '24', Maharashtra = '27'. */
  readonly gstStateCode: string;
}

/** A promo already looked up by code; usage counts supplied by the caller. */
export interface PromoInput {
  readonly code: string;
  readonly discountBps: number | null;
  readonly discountFlatPaise: bigint | null;
  readonly maxDiscountPaise: bigint | null;
  readonly minBookingPaise: bigint;
  readonly appliesToTiers: readonly PlanTier[] | null;
  readonly appliesToCityIds: readonly string[] | null;
  readonly firstBookingOnly: boolean;
  readonly perUserCap: number;
  /** promo_codes.total_redemption_cap; null = unlimited. */
  readonly totalRedemptionCap?: number | null;
  readonly validFrom: Date;
  readonly validTo: Date;
  readonly isActive: boolean;
  /** Times this user has already redeemed the code. */
  readonly userRedemptions: number;
  /** Redemptions across all users (needed only when totalRedemptionCap is set). */
  readonly totalRedemptions?: number;
  /** Bookings the user already has (for firstBookingOnly). */
  readonly userBookingCount: number;
}

export interface PricingRequest {
  readonly tier: PlanTier;
  readonly categoryCode: string;
  readonly venue: ResolvedVenue;
  readonly scheduledStart: Date;
  /** ≥ 2.0, multiples of 0.5. */
  readonly hours: number;
  /** Passed in, never read from the clock. Drives the emergency band and quote expiry. */
  readonly now: Date;
  readonly addons: ReadonlyArray<{ readonly code: string; readonly quantity: number }>;
  /** Exact distance in metres; when omitted the venue's zone is used at its minimum distance. */
  readonly travelDistanceMetres?: number;
  readonly promo?: PromoInput;
}

export type RejectionCode =
  | 'BELOW_MINIMUM'
  | 'INVALID_INCREMENT'
  | 'NO_BASE_RATE'
  | 'UNKNOWN_CATEGORY'
  | 'ADDON_NOT_PRICED'
  | 'ADDON_TIER_INELIGIBLE'
  | 'INVALID_ADDON_QUANTITY'
  | 'NO_TRAVEL_SLAB'
  | 'NO_EMERGENCY_RULE'
  | 'START_IN_PAST'
  | 'PROMO_INACTIVE'
  | 'PROMO_EXPIRED'
  | 'PROMO_NOT_APPLICABLE'
  | 'PROMO_MIN_NOT_MET'
  | 'PROMO_USAGE_EXCEEDED';

export interface QuoteLine {
  readonly code: string;
  readonly label: string;
  readonly detail?: string;
  readonly amountPaise?: bigint;
  readonly isFactor?: true;
  readonly factorBps?: number;
}

export interface GstBreakdown {
  readonly rateBps: number;
  readonly sac: string;
  readonly placeOfSupply: string;
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
}

export interface Quote {
  readonly kind: 'QUOTE';
  readonly rulesetId: string;
  readonly rulesetVersion: string;
  readonly tier: PlanTier;
  readonly cityTier: CityTier;
  readonly categoryCode: string;
  readonly hours: number;
  readonly emergencyBand: EmergencyBand;
  readonly isGuaranteed: boolean;
  readonly captureOnAcceptOnly: boolean;
  readonly autoRefundMinutesBefore: number | null;
  readonly isPeakSeason: boolean;
  readonly travelZone: 0 | 1 | 2;

  readonly baseRatePerHourPaise: bigint;
  readonly factors: {
    readonly categoryUpliftBps: number;
    readonly emergencyBps: number;
    readonly surgeBps: number;
    readonly nightBps: number;
    readonly weekendBps: number;
  };

  readonly baseAmountPaise: bigint;
  readonly addonsAmountPaise: bigint;
  readonly travelAmountPaise: bigint;
  readonly subtotalPaise: bigint;
  readonly discountAmountPaise: bigint;
  /** Exclusive branch: subtotal − discount. Inclusive branch: back-derived from the total. */
  readonly taxablePaise: bigint;
  readonly gst: GstBreakdown;
  readonly gstAmountPaise: bigint;
  readonly totalPaise: bigint;
  readonly pricesIncludeGst: boolean;
  /** NONE/NEXT_DAY: ceil(total/2). Otherwise the full total. */
  readonly advancePaise: bigint;
  readonly balancePaise: bigint;

  readonly payoutShareBps: number;
  readonly expectedPayoutPaise: bigint;
  readonly airspaceCheckRequired: boolean;
  readonly promoCode: string | null;
  readonly lines: readonly QuoteLine[];
  readonly computedAt: Date;
  /** now + 15 minutes. */
  readonly quoteExpiresAt: Date;
}

export type PricingResult =
  | Quote
  | { readonly kind: 'QUOTE_ONLY'; readonly tier: PlanTier; readonly rulesetVersion: string }
  | { readonly kind: 'REJECTED'; readonly code: RejectionCode; readonly message: string };

/** Extension (+1h blocks) and waiting-time pricing: base hourly × category uplift only. */
export interface ExtensionPrice {
  readonly hourlyPaise: bigint;
  readonly waitingHourlyPaise: bigint;
  readonly waitingGraceMinutes: number;
}
