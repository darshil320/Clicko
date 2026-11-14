import { type ShootMedia, VIDEO_DELIVERY } from '../../../content/moments';
import {
  BOOKABLE_TIERS,
  type BookableTier,
  VIDEOGRAPHER_MIN_TIER,
  VIDEOGRAPHER_PER_HOUR_PAISE,
} from '../../../content/rate-card';
import { TIERS } from '../../../content/tiers';
import { formatRupees } from '../../../lib/money';
import type { Quote } from '../../../lib/pricing';
import type { PickerCategory, PickerTier } from './types';

export interface QuoteCopy {
  readonly label: string;
  /** A rupee total when `priced`; otherwise where the price will come from. */
  readonly price: string;
  readonly lines: readonly string[];
  readonly priced: boolean;
}

const VIDEOGRAPHER_LINE = `+ videographer from ${formatRupees(VIDEOGRAPHER_PER_HOUR_PAISE)}/hr, priced in the app before you pay`;
const VIDEOGRAPHER_TIER_LINE = `A videographer is added from ${TIERS[VIDEOGRAPHER_MIN_TIER].label} up`;

const takesVideographer = (tier: BookableTier): boolean =>
  BOOKABLE_TIERS.indexOf(tier) >= BOOKABLE_TIERS.indexOf(VIDEOGRAPHER_MIN_TIER);

/**
 * What the picker says for each kind of shoot (ADR-0023, ADR-0032). Photo prices are exact from
 * the rate card; video is the videographer add-on, quoted by its hourly rate and priced in full in
 * the app before payment.
 */
export function describeQuote(media: ShootMedia, quote: Quote, tier: BookableTier): QuoteCopy {
  const photoLine = `${quote.base} + ${quote.gst} GST, ${quote.frames} delivered photos`;
  if (media === 'BOTH') {
    return {
      label: 'Photos',
      price: quote.total,
      lines: takesVideographer(tier)
        ? [photoLine, VIDEOGRAPHER_LINE, VIDEO_DELIVERY]
        : [photoLine, VIDEOGRAPHER_TIER_LINE],
      priced: true,
    };
  }
  return { label: 'You pay', price: quote.total, lines: [photoLine], priced: true };
}

/**
 * The tier we recommend for a category, said in words under the tier control (DESIGN.md
 * §Accessibility: never meaning by colour alone).
 */
export function recommendedNote(
  category: Pick<PickerCategory, 'label' | 'recommended'>,
  tiers: readonly Pick<PickerTier, 'code' | 'label'>[],
): string | undefined {
  const tier = tiers.find((t) => t.code === category.recommended);
  return tier ? `Recommended for ${category.label.toLowerCase()} shoots: ${tier.label}` : undefined;
}
