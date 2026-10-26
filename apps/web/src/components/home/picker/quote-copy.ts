import { type ShootMedia, VIDEO_DELIVERY, VIDEO_PRICE_NOTE } from '../../../content/moments';
import type { Quote } from '../../../lib/pricing';

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
  const photoLine = `${quote.base} + ${quote.gst} GST · ${quote.frames} delivered photos`;
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
