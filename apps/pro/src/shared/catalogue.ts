import { type EmergencyBand, MEDIA_LIMITS, type PlanTier } from '@clickco/contracts';

/**
 * Display copy for jobs. Mirrors the launch seed (apps/api …/launch-ruleset.seed.ts) and
 * doc 01 screen 12. Amounts never live here — payouts always come from the API.
 */

export interface TierRequirements {
  readonly gear: string;
  readonly framesPerHour: number;
  readonly dualCard: boolean;
}

/** What the client was sold, so what the photographer must bring and deliver. */
export const TIER_REQUIREMENTS: Readonly<Record<PlanTier, TierRequirements>> = {
  BASIC: { gear: 'APS-C or full-frame, 1 lens', framesPerHour: 40, dualCard: false },
  SEMI_PRO: { gear: 'Full-frame, 2 lenses', framesPerHour: 50, dualCard: false },
  PROFESSIONAL: { gear: 'Full-frame with lighting', framesPerHour: 60, dualCard: true },
  EXPERT: { gear: 'Flagship full-frame, 3+ lenses, lighting', framesPerHour: 75, dualCard: true },
  SIGNATURE: {
    gear: 'Flagship kit, full lighting, on-site backup',
    framesPerHour: 80,
    dualCard: true,
  },
};

/** Hours from check-out to the upload deadline (ADR-0014). */
export const UPLOAD_WITHIN_HOURS = MEDIA_LIMITS.uploadDeadlineHours;

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  FOOD: 'Food',
  WEDDING: 'Wedding',
  PORTRAIT: 'Portrait',
  PRODUCT: 'Product',
  EVENT: 'Event',
  REAL_ESTATE: 'Real Estate',
  CORPORATE: 'Corporate',
};

/** "REAL_ESTATE" → "Real Estate", for any code the catalogue does not list yet. */
export function categoryLabel(code: string): string {
  return (
    CATEGORY_LABEL[code] ??
    code
      .split('_')
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(' ')
  );
}

/** The lead-time band as a short badge (doc 05 §8), or null for a normal booking. */
export function emergencyLabel(band: EmergencyBand): string | null {
  switch (band) {
    case 'NONE':
      return null;
    case 'NEXT_DAY':
      return 'Next day';
    case 'SAME_DAY':
      return 'Same day';
    case 'HOURS_3_8':
      return 'Emergency · 3–8 h';
    case 'HOURS_UNDER_3':
      return 'Emergency · under 3 h';
  }
}

/** Under 8 hours' notice is the Emergency tier: the red treatment (DESIGN.md emergency colour). */
export const isEmergency = (band: EmergencyBand): boolean =>
  band === 'HOURS_3_8' || band === 'HOURS_UNDER_3';
