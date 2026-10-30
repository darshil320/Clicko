import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { CityTier, EmergencyBand, PlanTier } from './enums.js';
import { BasisPoints, Hours, MoneyPaise } from './money.js';
import { AddonCode, PriceQuote, QuoteOnly } from './pricing.js';

/**
 * ADR-0026 stream D — the pricing editor (ADR-0026 D4, doc 05 §11). Owned by stream D only.
 *
 * A ruleset is drafted (a full copy of a published one, `published_at IS NULL`), edited,
 * previewed against the engine, diffed against the live one, then published by FINANCE (or
 * SUPER_ADMIN) with a fresh authenticator code. Rulesets are never deleted: a draft that is not
 * wanted is discarded (closed unpublished); a published one is closed by the next publish.
 */

/** The numbers the editor enforces. Ranges match the schema §5 CHECK constraints. */
export const PRICING_EDITOR_LIMITS = {
  /** ₹1,00,000 an hour — twelve times the top launch rate; anything above is a typo. */
  maxHourlyPaise: 10_000_000,
  /** ₹1,00,000 for one add-on. */
  maxAddonPaise: 10_000_000,
  /** category_uplifts.uplift_range: 0.50× – 3.00×. */
  upliftMinBps: 5_000,
  upliftMaxBps: 30_000,
  /** festival_calendar.festival_multiplier_range: 1.00× – 2.50×. */
  surgeMinBps: 10_000,
  surgeMaxBps: 25_000,
  /** base_rates.payout_share_range. */
  payoutShareMaxBps: 10_000,
  /** Edits accepted in one request. */
  maxChangesPerRequest: 100,
  /** Open drafts at once (a cluttered list is how the wrong one gets published). */
  maxOpenDrafts: 10,
  /** A publish may be scheduled up to this far ahead. */
  maxScheduleDays: 90,
  /** A scheduled change can be cancelled until this close to going live (server clock skew). */
  cancelCutoffMinutes: 2,
  labelMaxLength: 80,
  /** How many past versions the overview lists. */
  historyLimit: 50,
} as const;

/** An IST calendar day, YYYY-MM-DD. */
export const PricingDay = z.iso.date();
export type PricingDay = z.infer<typeof PricingDay>;

export const PricingRulesetState = z.enum(['LIVE', 'SCHEDULED', 'DRAFT', 'CLOSED', 'DISCARDED']);
export type PricingRulesetState = z.infer<typeof PricingRulesetState>;

export const PricingRulesetRef = z.object({ id: Uuid, version: z.string() });
export type PricingRulesetRef = z.infer<typeof PricingRulesetRef>;

/** One ruleset as the lists show it. Drafts have no version and no effective window yet. */
export const PricingRulesetSummary = z.object({
  id: Uuid,
  state: PricingRulesetState,
  /** '2026.11.01' once published; null while a draft. */
  version: z.string().nullable(),
  label: z.string().nullable(),
  effectiveFrom: IsoDateTime.nullable(),
  effectiveTo: IsoDateTime.nullable(),
  publishedAt: IsoDateTime.nullable(),
  publishedBy: z.string().nullable(),
  createdAt: IsoDateTime,
  createdBy: z.string().nullable(),
  updatedAt: IsoDateTime,
  discardedAt: IsoDateTime.nullable(),
  discardedBy: z.string().nullable(),
  /** The published version this one was copied from. */
  basedOn: PricingRulesetRef.nullable(),
  /** Drafts only: rows that differ from the live rate card. */
  changeCount: z.int().min(0).nullable(),
});
export type PricingRulesetSummary = z.infer<typeof PricingRulesetSummary>;

/** GET /admin/pricing/rulesets */
export const AdminPricingOverview = z.object({
  live: PricingRulesetSummary.nullable(),
  scheduled: PricingRulesetSummary.nullable(),
  drafts: z.array(PricingRulesetSummary),
  /** Closed versions and discarded drafts, newest first. */
  history: z.array(PricingRulesetSummary),
});
export type AdminPricingOverview = z.infer<typeof AdminPricingOverview>;

// ── The rate card (GET /admin/pricing/rulesets/:id) ─────────────────────────

export const PricingBaseRateRow = z.object({
  id: Uuid,
  tier: PlanTier,
  cityTier: CityTier,
  ratePerHourPaise: MoneyPaise,
  payoutShareBps: BasisPoints,
  /** SIGNATURE: priced by enquiry, never instantly. */
  isQuoteOnly: z.boolean(),
});
export type PricingBaseRateRow = z.infer<typeof PricingBaseRateRow>;

export const PricingCategoryUpliftRow = z.object({
  id: Uuid,
  categoryCode: z.string(),
  categoryName: z.string(),
  /** null = every tier. */
  tier: PlanTier.nullable(),
  multiplierBps: BasisPoints,
});
export type PricingCategoryUpliftRow = z.infer<typeof PricingCategoryUpliftRow>;

export const PricingAddonPriceRow = z.object({
  id: Uuid,
  addonCode: z.string(),
  addonName: z.string(),
  tier: PlanTier.nullable(),
  cityTier: CityTier.nullable(),
  amountPaise: MoneyPaise,
  isPerHour: z.boolean(),
  payoutShareBps: BasisPoints,
});
export type PricingAddonPriceRow = z.infer<typeof PricingAddonPriceRow>;

export const PricingExtensionRateRow = z.object({
  id: Uuid,
  tier: PlanTier,
  cityTier: CityTier,
  /** Before category uplift; never surged (doc 05 §5). */
  hourlyPaise: MoneyPaise,
  waitingHourlyPaise: MoneyPaise,
  /** T&C §2.6 — not editable here. */
  waitingGraceMinutes: z.int().min(0),
});
export type PricingExtensionRateRow = z.infer<typeof PricingExtensionRateRow>;

export const PricingFestivalRow = z.object({
  id: Uuid,
  label: z.string(),
  dateFrom: PricingDay,
  dateTo: PricingDay,
  /** null = every city. */
  cityId: Uuid.nullable(),
  cityName: z.string().nullable(),
  multiplierBps: BasisPoints,
  /** T&C §3.2: inside 7 days of a peak-season shoot, half the advance is kept on cancellation. */
  isPeakSeason: z.boolean(),
});
export type PricingFestivalRow = z.infer<typeof PricingFestivalRow>;

export const PricingEmergencyRow = z.object({
  band: EmergencyBand,
  multiplierBps: BasisPoints,
  captureOnAcceptOnly: z.boolean(),
  isGuaranteed: z.boolean(),
  autoRefundMinutesBefore: z.int().nullable(),
});
export type PricingEmergencyRow = z.infer<typeof PricingEmergencyRow>;

export const PricingTimeRow = z.object({
  kind: z.enum(['NIGHT', 'WEEKEND']),
  multiplierBps: BasisPoints,
  /** NIGHT: 'HH:MM' local, inclusive start, exclusive end. */
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  /** WEEKEND: ISO days, 6 = Saturday, 7 = Sunday. */
  isoDays: z.array(z.int().min(1).max(7)).nullable(),
});
export type PricingTimeRow = z.infer<typeof PricingTimeRow>;

export const PricingTravelSlabRow = z.object({
  cityTier: CityTier,
  zone: z.int().min(0).max(2),
  fromKm: z.number().min(0),
  toKm: z.number().min(0).nullable(),
  flatPaise: MoneyPaise,
  perKmPaise: MoneyPaise,
  overnightPaise: MoneyPaise,
});
export type PricingTravelSlabRow = z.infer<typeof PricingTravelSlabRow>;

export const AdminPricingRuleset = z.object({
  summary: PricingRulesetSummary,
  pricesIncludeGst: z.boolean(),
  gstRateBps: BasisPoints,
  sacCode: z.string(),
  baseRates: z.array(PricingBaseRateRow),
  categoryUplifts: z.array(PricingCategoryUpliftRow),
  addonPrices: z.array(PricingAddonPriceRow),
  extensionRates: z.array(PricingExtensionRateRow),
  festivals: z.array(PricingFestivalRow),
  emergency: z.array(PricingEmergencyRow),
  timeMultipliers: z.array(PricingTimeRow),
  travelSlabs: z.array(PricingTravelSlabRow),
});
export type AdminPricingRuleset = z.infer<typeof AdminPricingRuleset>;

// ── Drafts ──────────────────────────────────────────────────────────────────

const DraftLabel = z.string().trim().min(2).max(PRICING_EDITOR_LIMITS.labelMaxLength);

/** POST /admin/pricing/rulesets/drafts */
export const AdminPricingCreateDraftBody = z.object({
  label: DraftLabel.nullable().default(null),
  /** Copy this published version (e.g. to roll back); default: the live one. */
  fromRulesetId: Uuid.nullable().default(null),
});
export type AdminPricingCreateDraftBody = z.input<typeof AdminPricingCreateDraftBody>;

const HourlyPaise = z.int().min(0).max(PRICING_EDITOR_LIMITS.maxHourlyPaise);

export const PricingFestivalFields = z
  .object({
    label: z.string().trim().min(2).max(PRICING_EDITOR_LIMITS.labelMaxLength),
    dateFrom: PricingDay,
    dateTo: PricingDay,
    cityId: Uuid.nullable(),
    multiplierBps: z
      .int()
      .min(PRICING_EDITOR_LIMITS.surgeMinBps, 'A festival price is at least 1.00×')
      .max(PRICING_EDITOR_LIMITS.surgeMaxBps, 'A festival price is at most 2.50×'),
    isPeakSeason: z.boolean(),
  })
  .refine((f) => f.dateTo >= f.dateFrom, {
    message: 'The last day must be on or after the first day',
    path: ['dateTo'],
  });
export type PricingFestivalFields = z.infer<typeof PricingFestivalFields>;

/** One edit to a draft. Rows are addressed by their id in that draft. */
export const PricingDraftChange = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('BASE_RATE'),
    id: Uuid,
    ratePerHourPaise: HourlyPaise,
    payoutShareBps: z.int().min(0).max(PRICING_EDITOR_LIMITS.payoutShareMaxBps),
    /** Extension hourly follows the new rate; waiting time stays at its share (doc 05 §5). */
    syncExtension: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('CATEGORY_UPLIFT'),
    id: Uuid,
    multiplierBps: z
      .int()
      .min(PRICING_EDITOR_LIMITS.upliftMinBps, 'A category price is at least 0.50×')
      .max(PRICING_EDITOR_LIMITS.upliftMaxBps, 'A category price is at most 3.00×'),
  }),
  z.object({
    kind: z.literal('ADDON_PRICE'),
    id: Uuid,
    amountPaise: z.int().min(0).max(PRICING_EDITOR_LIMITS.maxAddonPaise),
  }),
  z.object({
    kind: z.literal('EXTENSION_RATE'),
    id: Uuid,
    hourlyPaise: HourlyPaise,
    waitingHourlyPaise: HourlyPaise,
  }),
  z.object({ kind: z.literal('FESTIVAL_ADD'), festival: PricingFestivalFields }),
  z.object({ kind: z.literal('FESTIVAL_UPDATE'), id: Uuid, festival: PricingFestivalFields }),
  z.object({ kind: z.literal('FESTIVAL_REMOVE'), id: Uuid }),
]);
export type PricingDraftChange = z.input<typeof PricingDraftChange>;

/** POST /admin/pricing/rulesets/:id/edits — applied together or not at all. */
export const AdminPricingEditBody = z.object({
  changes: z.array(PricingDraftChange).min(1).max(PRICING_EDITOR_LIMITS.maxChangesPerRequest),
});
export type AdminPricingEditBody = z.input<typeof AdminPricingEditBody>;

// ── Diff (GET /admin/pricing/rulesets/:id/diff) ─────────────────────────────

export const PricingDiffSection = z.enum([
  'SETTINGS',
  'BASE_RATE',
  'CATEGORY_UPLIFT',
  'ADDON_PRICE',
  'EXTENSION_RATE',
  'FESTIVAL',
  'EMERGENCY',
  'TIME',
  'TRAVEL',
  'DELIVERABLE',
]);
export type PricingDiffSection = z.infer<typeof PricingDiffSection>;

/** before/after of one cell, by unit: money in paise, factors in basis points. */
export const PricingDiffValue = z.discriminatedUnion('unit', [
  z.object({
    unit: z.literal('PAISE'),
    before: MoneyPaise.nullable(),
    after: MoneyPaise.nullable(),
  }),
  z.object({ unit: z.literal('BPS'), before: z.int().nullable(), after: z.int().nullable() }),
  z.object({
    unit: z.literal('TEXT'),
    before: z.string().nullable(),
    after: z.string().nullable(),
  }),
  z.object({
    unit: z.literal('BOOL'),
    before: z.boolean().nullable(),
    after: z.boolean().nullable(),
  }),
  z.object({
    unit: z.literal('NUMBER'),
    before: z.number().nullable(),
    after: z.number().nullable(),
  }),
]);
export type PricingDiffValue = z.infer<typeof PricingDiffValue>;

export const PricingDiffField = z.object({
  field: z.string(),
  /** Plain language: 'Hourly rate', 'Photographer share'. */
  label: z.string(),
  value: PricingDiffValue,
});
export type PricingDiffField = z.infer<typeof PricingDiffField>;

export const PricingDiffChange = z.enum(['CHANGED', 'ADDED', 'REMOVED']);
export type PricingDiffChange = z.infer<typeof PricingDiffChange>;

export const PricingDiffRow = z.object({
  section: PricingDiffSection,
  /** Stable within one diff, e.g. 'BASE_RATE:PROFESSIONAL:TIER_1'. */
  key: z.string(),
  /** Plain language: 'Professional · Tier 1 cities'. */
  label: z.string(),
  change: PricingDiffChange,
  /** Only the fields that differ (every field for an added or removed row). */
  fields: z.array(PricingDiffField),
});
export type PricingDiffRow = z.infer<typeof PricingDiffRow>;

export const AdminPricingDiff = z.object({
  ruleset: z.object({
    id: Uuid,
    label: z.string().nullable(),
    basedOn: PricingRulesetRef.nullable(),
  }),
  /** What it is compared with: the live rate card (null when nothing is live). */
  against: PricingRulesetRef.nullable(),
  /** Live moved on since this draft was copied: those changes show here as reverts. */
  liveChangedSinceCopy: z.boolean(),
  rows: z.array(PricingDiffRow),
});
export type AdminPricingDiff = z.infer<typeof AdminPricingDiff>;

// ── Preview (GET /admin/pricing/rulesets/:id/preview) ───────────────────────

const csv = (value: unknown): unknown => {
  if (value === undefined || value === '') return [];
  if (Array.isArray(value)) return value.flatMap((v) => String(v).split(',')).filter(Boolean);
  return String(value).split(',').filter(Boolean);
};

/** Query string of the live calculator; also accepts typed values (the client validates first). */
export const AdminPricingPreviewQuery = z.object({
  tier: PlanTier,
  categoryCode: z.string().regex(/^[A-Z_]{2,32}$/),
  cityId: Uuid,
  hours: z.coerce.number().pipe(Hours),
  scheduledStart: IsoDateTime,
  addons: z.preprocess(csv, z.array(AddonCode).max(4)).default([]),
  travelDistanceKm: z.coerce.number().min(0).max(500).multipleOf(0.01).optional(),
});
export type AdminPricingPreviewQuery = z.output<typeof AdminPricingPreviewQuery>;

export const PricingPreviewResult = z.discriminatedUnion('kind', [
  PriceQuote.extend({
    /** What the photographer would be paid (doc 05 step 12). */
    expectedPayoutPaise: MoneyPaise,
  }),
  QuoteOnly,
  z.object({ kind: z.literal('REJECTED'), code: z.string(), message: z.string() }),
]);
export type PricingPreviewResult = z.infer<typeof PricingPreviewResult>;

export const PricingPreviewSide = z.object({
  rulesetId: Uuid,
  version: z.string().nullable(),
  label: z.string().nullable(),
  result: PricingPreviewResult,
});
export type PricingPreviewSide = z.infer<typeof PricingPreviewSide>;

export const AdminPricingPreview = z.object({
  city: z.object({ id: Uuid, name: z.string(), tier: CityTier }),
  /** The ruleset being previewed (normally a draft). */
  ruleset: PricingPreviewSide,
  /** The same request on the live rate card; null when nothing is live. */
  live: PricingPreviewSide.nullable(),
});
export type AdminPricingPreview = z.infer<typeof AdminPricingPreview>;

// ── Publish, cancel, discard ────────────────────────────────────────────────

/** A fresh authenticator code for a step-up action (ADR-0026 D4). */
export const StepUpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

/** POST /admin/pricing/rulesets/:id/publish */
export const AdminPricingPublishBody = z.object({
  code: StepUpCode,
  /** null = now. A later instant schedules the change. */
  effectiveFrom: IsoDateTime.nullable().default(null),
  /**
   * The draft's `updatedAt` as the publisher reviewed it: the code approves exactly that
   * content; an edit in between is refused (409 DRAFT_CHANGED_SINCE_REVIEW).
   */
  expectedUpdatedAt: IsoDateTime,
});
export type AdminPricingPublishBody = z.input<typeof AdminPricingPublishBody>;

export const AdminPricingPublishResponse = z.object({
  published: PricingRulesetSummary,
  /** The version it replaces (closed at the new version's start). */
  replaced: PricingRulesetSummary.nullable(),
});
export type AdminPricingPublishResponse = z.infer<typeof AdminPricingPublishResponse>;

/** Answer to discard and cancel-schedule: the ruleset after the change. */
export const AdminPricingRulesetChange = z.object({ ruleset: PricingRulesetSummary });
export type AdminPricingRulesetChange = z.infer<typeof AdminPricingRulesetChange>;

/**
 * The version a ruleset going live on `istDay` (YYYY-MM-DD, IST) is given: '2026.11.01', then
 * '2026.11.01.2', '2026.11.01.3' … when that day already has one. Shared so the publish dialog
 * shows the same version the server assigns.
 */
export function pricingVersionFor(istDay: string, taken: Iterable<string>): string {
  const base = istDay.replace(/-/g, '.');
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}.${n}`)) n += 1;
  return `${base}.${n}`;
}
