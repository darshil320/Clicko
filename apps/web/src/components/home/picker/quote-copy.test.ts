import { describe, expect, it } from 'vitest';
import { VIDEO_DELIVERY, VIDEO_PRICE_NOTE } from '../../../content/moments';
import { quoteFor } from '../../../lib/pricing';
import { describeQuote, recommendedNote } from './quote-copy';

const quote = quoteFor('PROFESSIONAL', 'TIER_1', 'PORTRAIT', 2);

describe('describeQuote (ADR-0023)', () => {
  it('photos: the exact total with GST and delivered photos', () => {
    expect(describeQuote('PHOTO', quote)).toEqual({
      label: 'You pay',
      price: '₹10,030',
      lines: ['₹8,500 + ₹1,530 GST, 120 delivered photos'],
      priced: true,
    });
  });

  it('photos + video: the photo price, and says video is priced in the app', () => {
    const copy = describeQuote('BOTH', quote);
    expect(copy.label).toBe('Photos');
    expect(copy.price).toBe('₹10,030');
    expect(copy.lines).toEqual([
      '₹8,500 + ₹1,530 GST, 120 delivered photos',
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

describe('recommendedNote', () => {
  const basic = { code: 'BASIC', label: 'Basic' } as const;
  const professional = { code: 'PROFESSIONAL', label: 'Professional' } as const;

  it('names the recommended tier in words', () => {
    const realEstate = { label: 'Real Estate', recommended: 'PROFESSIONAL' } as const;
    expect(recommendedNote(realEstate, [basic, professional])).toBe(
      'Recommended for real estate shoots: Professional',
    );
  });

  it('says nothing when the tier is not on offer', () => {
    const food = { label: 'Food', recommended: 'BASIC' } as const;
    expect(recommendedNote(food, [professional])).toBeUndefined();
  });
});
