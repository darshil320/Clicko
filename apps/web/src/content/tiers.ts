import type { PlanTier } from './rate-card';

/**
 * Plan copy. Mirrors the launch seed (apps/api/src/infra/db/seeds/launch-ruleset.seed.ts) and
 * apps/client/src/shared/catalogue.ts, with the SA-10 fix: "delivered" frames, never "edited".
 */
export interface TierCopy {
  readonly label: string;
  readonly tagline: string;
  readonly framesPerHour: number;
  readonly gear: string;
  readonly highlights: readonly string[];
  /** Left-edge tone, as packages/ui TIER_TONE: grey → white, Professional carries the accent. */
  readonly edge: 'tertiary' | 'secondary' | 'accent' | 'primary' | 'strong';
}

const DELIVERY = 'RAW + JPEG within 48 hours';

export const TIERS: Readonly<Record<PlanTier, TierCopy>> = {
  BASIC: {
    label: 'Basic',
    tagline: 'Everyday moments, simply covered',
    framesPerHour: 40,
    gear: 'APS-C or full-frame camera, 1 lens',
    highlights: ['40 delivered frames per hour', 'APS-C or full-frame camera, 1 lens', DELIVERY],
    edge: 'tertiary',
  },
  SEMI_PRO: {
    label: 'Semi-Pro',
    tagline: 'Sharper kit for portraits and small events',
    framesPerHour: 50,
    gear: 'Full-frame camera, 2 lenses',
    highlights: ['50 delivered frames per hour', 'Full-frame camera, 2 lenses', DELIVERY],
    edge: 'secondary',
  },
  PROFESSIONAL: {
    label: 'Professional',
    tagline: 'Full-frame with lighting, certified specialists',
    framesPerHour: 60,
    gear: 'Full-frame camera with lighting',
    highlights: [
      '60 delivered frames per hour',
      'Full-frame camera with lighting',
      'Dual-card backup',
      'Certified category specialist',
      DELIVERY,
    ],
    edge: 'accent',
  },
  EXPERT: {
    label: 'Expert',
    tagline: 'Flagship kit for brands and big days',
    framesPerHour: 75,
    gear: 'Flagship full-frame, 3+ lenses and lighting',
    highlights: [
      '75 delivered frames per hour',
      'Flagship full-frame, 3+ lenses and lighting',
      'Dual-card backup',
      'Certified category specialist',
      DELIVERY,
    ],
    edge: 'primary',
  },
  SIGNATURE: {
    label: 'Signature',
    tagline: 'A hand-picked photographer, quoted for you',
    framesPerHour: 80,
    gear: 'Flagship kit, full lighting, on-site backup',
    highlights: [
      'Hand-picked, named photographer — approve the portfolio first',
      'Second shooter and full lighting kit',
      'Clickco Edit included',
      'Dedicated account manager',
    ],
    edge: 'strong',
  },
};

/** What no standard tier includes (ADR-0003 RAW-only SLA, ADR-0005 photos-only launch). */
export const NOT_INCLUDED: readonly string[] = [
  'Editing and retouching — Clickco Edit is a separate paid service',
  'Edited video and reels — clips come unedited; a reel edit is a separate paid service',
  'Prints and albums',
];
