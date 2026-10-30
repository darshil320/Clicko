import type {
  CityTier,
  EmergencyBand,
  PlanTier,
  PricingDiffField,
  PricingDiffRow,
  PricingDiffSection,
  PricingDiffValue,
} from '@clickco/contracts';
import type { RulesetContent } from './ruleset-content';

/**
 * doc 05 §11 — "a diff view against the current ruleset, showing every changed cell". Rows are
 * matched on their meaning (tier × city tier, category, band …), never on row ids: a draft's rows
 * are copies with new ids. Festivals have no natural key, so they match on name + dates + city;
 * renaming one shows as one removed and one added. Pure.
 */

type Unit = PricingDiffValue['unit'];
type Scalar = string | number | boolean | null;

interface FieldSpec<R> {
  readonly field: string;
  readonly label: string;
  readonly unit: Unit;
  readonly get: (row: R) => Scalar;
}

interface SectionSpec<R> {
  readonly section: PricingDiffSection;
  readonly key: (row: R) => string;
  readonly label: (row: R) => string;
  readonly fields: readonly FieldSpec<R>[];
}

const TIER: Readonly<Record<PlanTier, string>> = {
  BASIC: 'Basic',
  SEMI_PRO: 'Semi-pro',
  PROFESSIONAL: 'Professional',
  EXPERT: 'Expert',
  SIGNATURE: 'Signature',
};

const CITY_TIER: Readonly<Record<CityTier, string>> = {
  METRO: 'Metro cities',
  TIER_1: 'Tier 1 cities',
  TIER_2: 'Tier 2 cities',
  TIER_3: 'Tier 3 cities',
};

const BAND: Readonly<Record<EmergencyBand, string>> = {
  NONE: 'Booked 2+ days ahead',
  NEXT_DAY: 'Booked 1–2 days ahead',
  SAME_DAY: 'Booked 8–24 hours ahead',
  HOURS_3_8: 'Booked 3–8 hours ahead',
  HOURS_UNDER_3: 'Booked under 3 hours ahead',
};

const DAY_NAME = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const f = <R>(field: string, label: string, unit: Unit, get: (row: R) => Scalar): FieldSpec<R> => ({
  field,
  label,
  unit,
  get,
});

type Row<K extends keyof RulesetContent> = RulesetContent[K] extends readonly (infer R)[]
  ? R
  : never;

const BASE_RATE: SectionSpec<Row<'baseRates'>> = {
  section: 'BASE_RATE',
  key: (r) => `BASE_RATE:${r.tier}:${r.cityTier}`,
  label: (r) => `${TIER[r.tier]} · ${CITY_TIER[r.cityTier]}`,
  fields: [
    f('ratePerHourPaise', 'Hourly rate', 'PAISE', (r) => r.ratePerHourPaise),
    f('payoutShareBps', 'Photographer share', 'BPS', (r) => r.payoutShareBps),
    f('isQuoteOnly', 'Quote only', 'BOOL', (r) => r.isQuoteOnly),
  ],
};

const CATEGORY_UPLIFT: SectionSpec<Row<'categoryUplifts'>> = {
  section: 'CATEGORY_UPLIFT',
  key: (r) => `CATEGORY_UPLIFT:${r.categoryCode}:${r.tier ?? 'ALL'}`,
  label: (r) => (r.tier ? `${r.categoryName} · ${TIER[r.tier]}` : r.categoryName),
  fields: [f('multiplierBps', 'Category price', 'BPS', (r) => r.multiplierBps)],
};

const ADDON_PRICE: SectionSpec<Row<'addonPrices'>> = {
  section: 'ADDON_PRICE',
  key: (r) => `ADDON_PRICE:${r.addonCode}:${r.tier ?? 'ALL'}:${r.cityTier ?? 'ALL'}`,
  label: (r) =>
    [r.addonName, r.tier ? TIER[r.tier] : null, r.cityTier ? CITY_TIER[r.cityTier] : null]
      .filter(Boolean)
      .join(' · '),
  fields: [
    f('amountPaise', 'Price', 'PAISE', (r) => r.amountPaise),
    f('isPerHour', 'Charged per hour', 'BOOL', (r) => r.isPerHour),
    f('payoutShareBps', 'Photographer share', 'BPS', (r) => r.payoutShareBps),
  ],
};

const EXTENSION_RATE: SectionSpec<Row<'extensionRates'>> = {
  section: 'EXTENSION_RATE',
  key: (r) => `EXTENSION_RATE:${r.tier}:${r.cityTier}`,
  label: (r) => `${TIER[r.tier]} · ${CITY_TIER[r.cityTier]}`,
  fields: [
    f('hourlyPaise', 'Extra hour', 'PAISE', (r) => r.hourlyPaise),
    f('waitingHourlyPaise', 'Waiting, per hour', 'PAISE', (r) => r.waitingHourlyPaise),
    f('waitingGraceMinutes', 'Free waiting (minutes)', 'NUMBER', (r) => r.waitingGraceMinutes),
  ],
};

const FESTIVAL: SectionSpec<Row<'festivals'>> = {
  section: 'FESTIVAL',
  key: (r) => `FESTIVAL:${r.label}:${r.dateFrom}:${r.dateTo}:${r.cityId ?? 'ALL'}`,
  label: (r) => `${r.label} · ${r.cityName ?? 'all cities'}`,
  fields: [
    f('label', 'Name', 'TEXT', (r) => r.label),
    f('dateFrom', 'From', 'TEXT', (r) => r.dateFrom),
    f('dateTo', 'To', 'TEXT', (r) => r.dateTo),
    f('cityName', 'City', 'TEXT', (r) => r.cityName ?? 'All cities'),
    f('multiplierBps', 'Festival price', 'BPS', (r) => r.multiplierBps),
    f('isPeakSeason', 'Peak season', 'BOOL', (r) => r.isPeakSeason),
  ],
};

const EMERGENCY: SectionSpec<Row<'emergency'>> = {
  section: 'EMERGENCY',
  key: (r) => `EMERGENCY:${r.band}`,
  label: (r) => BAND[r.band],
  fields: [
    f('multiplierBps', 'Price factor', 'BPS', (r) => r.multiplierBps),
    f('isGuaranteed', 'Guaranteed', 'BOOL', (r) => r.isGuaranteed),
    f('captureOnAcceptOnly', 'Charged only when accepted', 'BOOL', (r) => r.captureOnAcceptOnly),
    f(
      'autoRefundMinutesBefore',
      'Auto-cancel (minutes before)',
      'NUMBER',
      (r) => r.autoRefundMinutesBefore,
    ),
  ],
};

const TIME: SectionSpec<Row<'timeMultipliers'>> = {
  section: 'TIME',
  key: (r) => `TIME:${r.kind}`,
  label: (r) => (r.kind === 'NIGHT' ? 'Night shoots' : 'Weekend shoots'),
  fields: [
    f('multiplierBps', 'Price factor', 'BPS', (r) => r.multiplierBps),
    f('windowStart', 'Starts', 'TEXT', (r) => r.windowStart),
    f('windowEnd', 'Ends', 'TEXT', (r) => r.windowEnd),
    f('isoDays', 'Days', 'TEXT', (r) =>
      r.isoDays ? r.isoDays.map((d) => DAY_NAME[d] ?? String(d)).join(', ') : null,
    ),
  ],
};

const TRAVEL: SectionSpec<Row<'travelSlabs'>> = {
  section: 'TRAVEL',
  key: (r) => `TRAVEL:${r.cityTier}:${r.zone}`,
  label: (r) => `${CITY_TIER[r.cityTier]} · zone ${r.zone}`,
  fields: [
    f('fromKm', 'From (km)', 'NUMBER', (r) => r.fromKm),
    f('toKm', 'To (km)', 'NUMBER', (r) => r.toKm),
    f('flatPaise', 'Flat', 'PAISE', (r) => r.flatPaise),
    f('perKmPaise', 'Per km', 'PAISE', (r) => r.perKmPaise),
    f('overnightPaise', 'Overnight', 'PAISE', (r) => r.overnightPaise),
  ],
};

const DELIVERABLE: SectionSpec<Row<'deliverables'>> = {
  section: 'DELIVERABLE',
  key: (r) => `DELIVERABLE:${r.tier}`,
  label: (r) => TIER[r.tier],
  fields: [
    f('framesPerHour', 'Photos per hour', 'NUMBER', (r) => r.framesPerHour),
    f('gearClass', 'Gear', 'TEXT', (r) => r.gearClass),
    f('dualCardRequired', 'Dual card', 'BOOL', (r) => r.dualCardRequired),
    f('secondShooterIncluded', 'Second shooter included', 'BOOL', (r) => r.secondShooterIncluded),
    f('rawIncluded', 'RAW included', 'BOOL', (r) => r.rawIncluded),
    f('jpegIncluded', 'JPEG included', 'BOOL', (r) => r.jpegIncluded),
    f('videoIncluded', 'Video included', 'BOOL', (r) => r.videoIncluded),
    f('editIncluded', 'Editing included', 'BOOL', (r) => r.editIncluded),
    f('deliveryHours', 'Delivery (hours)', 'NUMBER', (r) => r.deliveryHours),
    f('minHours', 'Minimum hours', 'NUMBER', (r) => r.minHours),
    f('isInstantBookable', 'Instant booking', 'BOOL', (r) => r.isInstantBookable),
  ],
};

const SETTINGS: SectionSpec<RulesetContent['settings']> = {
  section: 'SETTINGS',
  key: () => 'SETTINGS',
  label: () => 'GST',
  fields: [
    f('pricesIncludeGst', 'Prices include GST', 'BOOL', (r) => r.pricesIncludeGst),
    f('gstRateBps', 'GST rate', 'BPS', (r) => r.gstRateBps),
    f('sacCode', 'SAC code', 'TEXT', (r) => r.sacCode),
  ],
};

/** A typed before/after pair; the unit's own scalar type is guaranteed by the field getter. */
function pairOf(unit: Unit, before: Scalar, after: Scalar): PricingDiffValue {
  return { unit, before, after } as PricingDiffValue;
}

function fieldsOf<R>(spec: SectionSpec<R>, before: R | null, after: R | null): PricingDiffField[] {
  return spec.fields.flatMap((field) => {
    const b = before === null ? null : field.get(before);
    const a = after === null ? null : field.get(after);
    if (before !== null && after !== null && b === a) return [];
    return [{ field: field.field, label: field.label, value: pairOf(field.unit, b, a) }];
  });
}

/** Groups rows by key, keeping their order; duplicates queue up and pair one to one. */
function byKey<R>(spec: SectionSpec<R>, rows: readonly R[]): Map<string, R[]> {
  const out = new Map<string, R[]>();
  for (const row of rows) {
    const key = spec.key(row);
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}

function diffSection<R>(
  spec: SectionSpec<R>,
  after: readonly R[],
  before: readonly R[],
): PricingDiffRow[] {
  const remaining = byKey(spec, before);
  const take = (key: string): R | null => {
    const queue = remaining.get(key);
    const [first, ...rest] = queue ?? [];
    if (first === undefined) return null;
    remaining.set(key, rest);
    return first;
  };
  const row = (r: R, change: PricingDiffRow['change'], fields: PricingDiffField[]) => ({
    section: spec.section,
    key: spec.key(r),
    label: spec.label(r),
    change,
    fields,
  });
  const matched = after.flatMap((a): PricingDiffRow[] => {
    const b = take(spec.key(a));
    if (b === null) return [row(a, 'ADDED', fieldsOf(spec, null, a))];
    const fields = fieldsOf(spec, b, a);
    return fields.length === 0 ? [] : [row(a, 'CHANGED', fields)];
  });
  const removed = [...remaining.values()]
    .flat()
    .map((b) => row(b, 'REMOVED', fieldsOf(spec, b, null)));
  return [...matched, ...removed];
}

/** Every changed, added or removed row of `draft` against `against` (null: nothing live). */
export function diffRulesets(
  draft: RulesetContent,
  against: RulesetContent | null,
): PricingDiffRow[] {
  const was = <K extends keyof RulesetContent>(key: K) =>
    against === null ? [] : (against[key] as readonly Row<K>[]);
  return [
    ...diffSection(SETTINGS, [draft.settings], against === null ? [] : [against.settings]),
    ...diffSection(BASE_RATE, draft.baseRates, was('baseRates')),
    ...diffSection(CATEGORY_UPLIFT, draft.categoryUplifts, was('categoryUplifts')),
    ...diffSection(ADDON_PRICE, draft.addonPrices, was('addonPrices')),
    ...diffSection(EXTENSION_RATE, draft.extensionRates, was('extensionRates')),
    ...diffSection(FESTIVAL, draft.festivals, was('festivals')),
    ...diffSection(EMERGENCY, draft.emergency, was('emergency')),
    ...diffSection(TIME, draft.timeMultipliers, was('timeMultipliers')),
    ...diffSection(TRAVEL, draft.travelSlabs, was('travelSlabs')),
    ...diffSection(DELIVERABLE, draft.deliverables, was('deliverables')),
  ];
}
