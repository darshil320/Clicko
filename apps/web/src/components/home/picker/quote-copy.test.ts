import { describe, expect, it } from 'vitest';
import { VIDEO_DELIVERY, VIDEO_PRICE_NOTE } from '../../../content/moments';
import { quoteFor } from '../../../lib/pricing';
import { describeQuote } from './quote-copy';

const quote = quoteFor('PROFESSIONAL', 'TIER_1', 'PORTRAIT', 2);

describe('describeQuote (ADR-0023)', () => {
  it('photos: the exact total with GST and delivered photos', () => {
    expect(describeQuote('PHOTO', quote)).toEqual({
      label: 'You pay',
      price: '₹10,030',
      lines: ['₹8,500 + ₹1,530 GST · 120 delivered photos'],
      priced: true,
    });
  });

  it('photos + video: the photo price, and says video is priced in the app', () => {
    const copy = describeQuote('BOTH', quote);
    expect(copy.label).toBe('Photos');
    expect(copy.price).toBe('₹10,030');
    expect(copy.lines).toEqual([
      '₹8,500 + ₹1,530 GST · 120 delivered photos',
      `+ video, ${VIDEO_PRICE_NOTE}`,
    ]);
  });

  it('video alone never shows a rupee figure', () => {
    const copy = describeQuote('VIDEO', quote);
    expect(copy.priced).toBe(false);
    expect(`${copy.label} ${copy.price} ${copy.lines.join(' ')}`).not.toContain('₹');
    expect(copy.lines).toEqual([VIDEO_DELIVERY]);
  });
});
