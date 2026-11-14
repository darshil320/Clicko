import { describe, expect, it } from 'vitest';
import { VIDEO_DELIVERY } from '../../../content/moments';
import { quoteFor } from '../../../lib/pricing';
import { describeQuote, recommendedNote } from './quote-copy';

const quote = quoteFor('PROFESSIONAL', 'TIER_1', 'PORTRAIT', 2);

describe('describeQuote (ADR-0023)', () => {
  it('photos: the exact total with GST and delivered photos', () => {
    expect(describeQuote('PHOTO', quote, 'PROFESSIONAL')).toEqual({
      label: 'You pay',
      price: '₹10,030',
      lines: ['₹8,500 + ₹1,530 GST, 120 delivered photos'],
      priced: true,
    });
  });

  it('photos + video: the photo price, then the videographer add-on rate (ADR-0032)', () => {
    const copy = describeQuote('BOTH', quote, 'PROFESSIONAL');
    expect(copy.label).toBe('Photos');
    expect(copy.price).toBe('₹10,030');
    expect(copy.lines).toEqual([
      '₹8,500 + ₹1,530 GST, 120 delivered photos',
      '+ videographer from ₹2,000/hr, priced in the app before you pay',
      VIDEO_DELIVERY,
    ]);
  });

  it('photos + video on Basic says the videographer needs Semi-Pro or above', () => {
    const basic = quoteFor('BASIC', 'TIER_1', 'PORTRAIT', 2);
    const copy = describeQuote('BOTH', basic, 'BASIC');
    expect(copy.lines).toContain('A videographer is added from Semi-Pro up');
    expect(copy.lines.join(' ')).not.toContain('₹2,000/hr');
  });

  it('video delivery promises unedited clips and never an edited reel', () => {
    expect(VIDEO_DELIVERY).toMatch(/unedited/i);
    expect(VIDEO_DELIVERY).not.toMatch(/reel edits are a paid add-on/i);
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
