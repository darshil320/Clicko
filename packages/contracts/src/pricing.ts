import { z } from 'zod';
import { IsoDateTime, Pincode } from './common.js';
import { CityTier, EmergencyBand, PlanTier } from './enums.js';
import { BasisPoints, Hours, MoneyPaise, SignedMoneyPaise } from './money.js';

export const AddonCode = z.enum(['SECOND_SHOOTER', 'DRONE', 'LIGHTING_KIT', 'RUSH_24H']);
export type AddonCode = z.infer<typeof AddonCode>;

export const QuoteRequestBody = z.object({
  tier: PlanTier,
  categoryCode: z.string().regex(/^[A-Z_]{2,32}$/),
  pincode: Pincode,
  scheduledStart: IsoDateTime,
  hours: Hours,
  addons: z
    .array(z.object({ code: AddonCode, quantity: z.int().min(1).max(4).default(1) }))
    .max(8)
    .default([]),
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
