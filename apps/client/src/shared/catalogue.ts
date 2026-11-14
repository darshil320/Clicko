import type { AddonCode, PlanTier } from '@clickco/contracts';

/**
 * Display copy for the catalogue. The API has no catalogue endpoint yet, so labels and
 * deliverables mirror the launch seed (apps/api …/launch-ruleset.seed.ts, doc 01 Screen 2
 * with the SA-10 copy fix). PRICES ARE NEVER HERE — they always come from /pricing/quote.
 * Server-side validation stays authoritative: eligibility below only shapes the UI.
 */

export const TIER_ORDER: readonly PlanTier[] = [
  'BASIC',
  'SEMI_PRO',
  'PROFESSIONAL',
  'EXPERT',
  'SIGNATURE',
];

/** Everything but Signature, which is booked by enquiry (v0.2 §10). */
export type BookableTier = Exclude<PlanTier, 'SIGNATURE'>;
export const BOOKABLE_TIERS: readonly BookableTier[] = [
  'BASIC',
  'SEMI_PRO',
  'PROFESSIONAL',
  'EXPERT',
];

export function isBookableTier(tier: PlanTier): tier is BookableTier {
  return tier !== 'SIGNATURE';
}

export interface TierCopy {
  readonly tagline: string;
  readonly framesPerHour: number;
  readonly gear: string;
  readonly included: readonly string[];
}

const DELIVERY = 'RAW + JPEG delivery in 48 hours';

export const TIER_COPY: Readonly<Record<PlanTier, TierCopy>> = {
  BASIC: {
    tagline: 'Everyday moments, simply covered',
    framesPerHour: 40,
    gear: 'APS-C or full-frame, 1 lens',
    included: ['40 delivered frames per hour', 'APS-C or full-frame camera, 1 lens', DELIVERY],
  },
  SEMI_PRO: {
    tagline: 'Sharper kit for portraits and small events',
    framesPerHour: 50,
    gear: 'Full-frame, 2 lenses',
    included: ['50 delivered frames per hour', 'Full-frame camera, 2 lenses', DELIVERY],
  },
  PROFESSIONAL: {
    tagline: 'Full-frame with lighting, certified specialists',
    framesPerHour: 60,
    gear: 'Full-frame with lighting',
    included: [
      '60 delivered frames per hour',
      'Full-frame camera with lighting',
      'Dual-card backup',
      'Certified category specialist',
      DELIVERY,
    ],
  },
  EXPERT: {
    tagline: 'Flagship kit for brands and big days',
    framesPerHour: 75,
    gear: 'Flagship full-frame, 3+ lenses, lighting',
    included: [
      '75 delivered frames per hour',
      'Flagship full-frame, 3+ lenses and lighting',
      'Dual-card backup',
      'Certified category specialist',
      DELIVERY,
    ],
  },
  SIGNATURE: {
    tagline: 'A hand-picked photographer, quoted for you',
    framesPerHour: 80,
    gear: 'Flagship kit, full lighting, on-site backup',
    included: [
      'Hand-picked, named photographer — approve the portfolio first',
      'Second shooter and full lighting kit',
      'Clickco Edit included',
      'Dedicated account manager',
    ],
  },
};

/** What no tier includes (ADR-0003 raw-only SLA; ADR-0034 video is an add-on, reels priced apiece). */
export const NOT_INCLUDED: readonly string[] = [
  'Editing and retouching — Clickco Edit is booked separately',
  'Video — add a videographer, then reels or raw footage; other video editing is separate',
  'Prints and albums',
  'Travel beyond 15 km is charged per km',
];

export interface CategoryInfo {
  readonly code: string;
  readonly label: string;
}

/** Launch categories in the seed's sort order. */
export const CATEGORIES: readonly CategoryInfo[] = [
  { code: 'FOOD', label: 'Food' },
  { code: 'WEDDING', label: 'Wedding' },
  { code: 'PORTRAIT', label: 'Portrait' },
  { code: 'PRODUCT', label: 'Product' },
  { code: 'EVENT', label: 'Event' },
  { code: 'REAL_ESTATE', label: 'Real Estate' },
  { code: 'CORPORATE', label: 'Corporate' },
];

/** Portrait carries no category uplift — the honest base for "from" prices. */
export const REFERENCE_CATEGORY = 'PORTRAIT';

/** "REAL_ESTATE" → "Real Estate", for any code the catalogue does not list yet. */
export function categoryLabel(code: string): string {
  const known = CATEGORIES.find((c) => c.code === code);
  if (known) return known.label;
  return code
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

export interface AddonInfo {
  readonly code: AddonCode;
  readonly label: string;
  readonly minTier: PlanTier;
  readonly note?: string;
  /** Only bookable with this add-on on (ADR-0034: reels and raw footage need the videographer). */
  readonly requires?: AddonCode;
  /** Booked as a count (reels) rather than on/off. Mirrors the server's addons.max_quantity. */
  readonly maxCount?: number;
}

/** The server's limit on reels per booking (addons.max_quantity, ADR-0034). */
export const REELS_MAX = 20;

export const ADDONS: readonly AddonInfo[] = [
  {
    code: 'SECOND_SHOOTER',
    label: 'Second shooter',
    minTier: 'SEMI_PRO',
    note: 'Charged per hour',
  },
  {
    code: 'VIDEOGRAPHER',
    label: 'Videographer',
    minTier: 'BASIC',
    note: 'Charged per hour at your plan’s video rate',
  },
  {
    code: 'REELS',
    label: 'Reels',
    minTier: 'BASIC',
    note: 'Edited vertical reels, priced per reel — less per reel when you order more',
    requires: 'VIDEOGRAPHER',
    maxCount: REELS_MAX,
  },
  {
    code: 'RAW_FOOTAGE',
    label: 'Raw footage',
    minTier: 'BASIC',
    note: 'Every unedited clip, one price per booking',
    requires: 'VIDEOGRAPHER',
  },
  {
    code: 'DRONE',
    label: 'Drone coverage',
    minTier: 'PROFESSIONAL',
    note: 'Subject to airspace clearance',
  },
  { code: 'LIGHTING_KIT', label: 'Lighting kit', minTier: 'SEMI_PRO' },
  { code: 'RUSH_24H', label: '24-hour delivery', minTier: 'PROFESSIONAL' },
];

export function tierRank(tier: PlanTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function eligibleAddons(tier: PlanTier): readonly AddonInfo[] {
  return ADDONS.filter((addon) => tierRank(tier) >= tierRank(addon.minTier));
}

/** The add-ons listed on their own (switches). */
export function topLevelAddons(tier: PlanTier): readonly AddonInfo[] {
  return eligibleAddons(tier).filter((addon) => addon.requires === undefined);
}

/** The add-ons shown beneath `parent` once it is on (reels and raw footage under video). */
export function addonsUnder(tier: PlanTier, parent: AddonCode): readonly AddonInfo[] {
  return eligibleAddons(tier).filter((addon) => addon.requires === parent);
}

export function addonInfo(code: AddonCode): AddonInfo | undefined {
  return ADDONS.find((addon) => addon.code === code);
}
