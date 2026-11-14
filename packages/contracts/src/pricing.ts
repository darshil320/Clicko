import { z } from 'zod';
import { IsoDateTime, Pincode } from './common.js';
import { CityTier, EmergencyBand, PlanTier } from './enums.js';
import { BasisPoints, Hours, MoneyPaise, SignedMoneyPaise } from './money.js';

export const AddonCode = z.enum([
  'SECOND_SHOOTER',
  'VIDEOGRAPHER',
  'DRONE',
  'LIGHTING_KIT',
  'RUSH_24H',
  'REELS',
  'RAW_FOOTAGE',
]);
export type AddonCode = z.infer<typeof AddonCode>;

/**
 * Input sanity only: the most units any add-on line may ask for (20 reels, ADR-0034). The ruleset's
 * own per-add-on limit (addons.max_quantity) is enforced by the pricing engine.
 */
export const ADDON_QUANTITY_CEILING = 20;

export const AddonSelection = z.object({
  code: AddonCode,
  quantity: z.int().min(1).max(ADDON_QUANTITY_CEILING).default(1),
});

export const QuoteRequestBody = z.object({
  tier: PlanTier,
  categoryCode: z.string().regex(/^[A-Z_]{2,32}$/),
  pincode: Pincode,
  scheduledStart: IsoDateTime,
  hours: Hours,
  addons: z.array(AddonSelection).max(8).default([]),
  /** Optional exact distance; two decimals at most (metre precision is plenty). */
  travelDistanceKm: z.number().min(0).max(500).multipleOf(0.01).optional(),
  promoCode: z.string().trim().toUpperCase().min(3).max(32).optional(),
});
export type QuoteRequestBody = z.input<typeof QuoteRequestBody>;
export type QuoteRequest = z.output<typeof QuoteRequestBody>;

export const QuoteLine = z.object({
  code: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  amountPaise: SignedMoneyPaise.optional(),
  isFactor: z.literal(true).optional(),
  factorBps: BasisPoints.optional(),
});

/** doc 05 §7 breakdown, plus the booking-flow flags the client needs to render the quote. */
export const PriceQuote = z.object({
  kind: z.literal('QUOTE'),
  currency: z.literal('INR'),
  pricesIncludeGst: z.boolean(),
  tier: PlanTier,
  cityTier: CityTier,
  categoryCode: z.string(),
  hours: Hours,
  emergencyBand: EmergencyBand,
  isGuaranteed: z.boolean(),
  captureOnAcceptOnly: z.boolean(),
  isPeakSeason: z.boolean(),
  travelZone: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  airspaceCheckRequired: z.boolean(),
  lines: z.array(QuoteLine),
  subtotalPaise: MoneyPaise,
  discountPaise: MoneyPaise,
  gst: z.object({
    rateBps: BasisPoints,
    sac: z.string(),
    placeOfSupply: z.string(),
    cgstPaise: MoneyPaise,
    sgstPaise: MoneyPaise,
    igstPaise: MoneyPaise,
  }),
  totalPaise: MoneyPaise,
  advancePaise: MoneyPaise,
  balancePaise: MoneyPaise,
  factorsApplied: z.object({
    categoryUpliftBps: BasisPoints,
    emergencyBps: BasisPoints,
    surgeBps: BasisPoints,
    nightBps: BasisPoints,
    weekendBps: BasisPoints,
  }),
  rulesetVersion: z.string(),
  computedAt: IsoDateTime,
  quoteExpiresAt: IsoDateTime,
});
export type PriceQuote = z.infer<typeof PriceQuote>;

export const QuoteOnly = z.object({
  kind: z.literal('QUOTE_ONLY'),
  tier: PlanTier,
  rulesetVersion: z.string(),
});

export const QuoteResponse = z.discriminatedUnion('kind', [PriceQuote, QuoteOnly]);
export type QuoteResponse = z.infer<typeof QuoteResponse>;
