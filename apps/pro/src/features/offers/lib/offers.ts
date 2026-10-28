import type { EmergencyBand, OfferArea, PlanTier, ProOffer } from '@clickco/contracts';
import { categoryLabel, TIER_REQUIREMENTS, UPLOAD_WITHIN_HOURS } from '@/shared/catalogue';
import { formatHours } from '@/shared/format/datetime';
import { secondsLeft } from './countdown';

/** Under 3 hours' notice first, then 3–8 hours, then everything else (doc 05 §8 bands). */
const BAND_RANK: Readonly<Record<EmergencyBand, number>> = {
  HOURS_UNDER_3: 0,
  HOURS_3_8: 1,
  SAME_DAY: 2,
  NEXT_DAY: 2,
  NONE: 2,
};

function compareOffers(a: ProOffer, b: ProOffer): number {
  return (
    BAND_RANK[a.emergencyBand] - BAND_RANK[b.emergencyBand] ||
    Date.parse(a.expiresAt) - Date.parse(b.expiresAt) ||
    a.attemptId.localeCompare(b.attemptId)
  );
}

/**
 * The offers that can still be accepted, emergency first, then the soonest to close. A new
 * array: the query cache is never reordered in place.
 */
export function liveOffers(offers: readonly ProOffer[], now: Date): readonly ProOffer[] {
  return offers.filter((offer) => secondsLeft(offer.expiresAt, now) > 0).sort(compareOffers);
}

/** What the client was sold: the tier's frames per hour × the booked hours (doc 01 screen 12). */
export function expectedFrames(tier: PlanTier, hours: number): number {
  return Math.round(TIER_REQUIREMENTS[tier].framesPerHour * hours);
}

/** "3.5 km away". The API rounds to 0.5 km, so 0 means closer than that. */
export function distanceText(km: number | null): string {
  if (km === null) return 'Distance not known';
  if (km === 0) return 'Under 0.5 km away';
  return `${km} km away`;
}

/** "Vesu, Surat" — the area only, never the address (that is revealed on accept). */
export function areaText(area: OfferArea): string {
  const name = area.areaName?.trim();
  return name && name !== area.cityName ? `${name}, ${area.cityName}` : area.cityName;
}

export type RequirementKind = 'gear' | 'dualCard' | 'frames' | 'category' | 'upload';

export interface Requirement {
  readonly kind: RequirementKind;
  readonly title: string;
  readonly detail?: string;
}

/**
 * Doc 01 screen 12's requirements list, from the tier catalogue. `tierLabel` is the display
 * name ("Professional"), passed in so this stays free of UI imports.
 */
export function offerRequirements(
  offer: Pick<ProOffer, 'tier' | 'scheduledHours' | 'categoryCode'>,
  tierLabel: string,
): readonly Requirement[] {
  const tier = TIER_REQUIREMENTS[offer.tier];
  const requirements: readonly (Requirement | null)[] = [
    { kind: 'gear', title: tier.gear, detail: `${tierLabel} tier` },
    tier.dualCard
      ? {
          kind: 'dualCard',
          title: 'Dual-card recording required',
          detail: 'Record to two cards at once',
        }
      : null,
    {
      kind: 'frames',
      title: `About ${expectedFrames(offer.tier, offer.scheduledHours)} frames expected`,
      detail: `${tier.framesPerHour} an hour × ${formatHours(offer.scheduledHours)}`,
    },
    {
      kind: 'category',
      title: `${categoryLabel(offer.categoryCode)} shoot`,
      detail: `${formatHours(offer.scheduledHours)} booked`,
    },
    {
      kind: 'upload',
      title: `Upload RAW + JPEG within ${UPLOAD_WITHIN_HOURS} hours of check-out`,
      detail: 'From a computer, on the Clickco upload portal',
    },
  ];
  return requirements.filter((r): r is Requirement => r !== null);
}
