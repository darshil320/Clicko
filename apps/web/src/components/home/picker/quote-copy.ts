import { type ShootMedia, VIDEO_DELIVERY, VIDEO_PRICE_NOTE } from '../../../content/moments';
import type { Quote } from '../../../lib/pricing';
import type { PickerCategory, PickerTier } from './types';

export interface QuoteCopy {
  readonly label: string;
  /** A rupee total when `priced`; otherwise where the price will come from. */
  readonly price: string;
  readonly lines: readonly string[];
  readonly priced: boolean;
}

/**
 * What the picker says for each kind of shoot (ADR-0023). Photo prices are exact from the rate
 * card; video has no rate yet, so it is never given a figure.
 */
export function describeQuote(media: ShootMedia, quote: Quote): QuoteCopy {
  const photoLine = `${quote.base} + ${quote.gst} GST, ${quote.frames} delivered photos`;
  if (media === 'VIDEO') {
    return { label: 'Video', price: 'Priced in the app', lines: [VIDEO_DELIVERY], priced: false };
  }
  if (media === 'BOTH') {
    return {
      label: 'Photos',
      price: quote.total,
      lines: [photoLine, `+ video, ${VIDEO_PRICE_NOTE}`],
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
