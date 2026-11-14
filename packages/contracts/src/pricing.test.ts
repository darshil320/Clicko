import { describe, expect, it } from 'vitest';
import { AddonCode, AdminPricingPreviewQuery, QuoteRequestBody } from './index.js';

describe('AddonCode', () => {
  it('offers the video add-ons beside the launch add-ons (ADR-0032, ADR-0034)', () => {
    expect(AddonCode.options).toEqual([
      'SECOND_SHOOTER',
      'VIDEOGRAPHER',
      'DRONE',
      'LIGHTING_KIT',
      'RUSH_24H',
      'REELS',
      'RAW_FOOTAGE',
    ]);
  });

  const withReels = (quantity: number) =>
    QuoteRequestBody.safeParse({
      tier: 'SEMI_PRO',
      categoryCode: 'PORTRAIT',
      pincode: '395007',
      scheduledStart: '2027-03-16T11:00:00+05:30',
      hours: 2,
      addons: [{ code: 'VIDEOGRAPHER' }, { code: 'REELS', quantity }],
    });

  it('accepts up to 20 reels in a quote request (ADR-0034)', () => {
    expect(withReels(20).success).toBe(true);
  });

  it('refuses 21 reels at the boundary', () => {
    expect(withReels(21).success).toBe(false);
  });

  it('accepts a videographer in a quote request', () => {
    const parsed = QuoteRequestBody.safeParse({
      tier: 'SEMI_PRO',
      categoryCode: 'PORTRAIT',
      pincode: '395007',
      scheduledStart: '2027-03-16T11:00:00+05:30',
      hours: 2,
      addons: [{ code: 'VIDEOGRAPHER' }],
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.addons).toEqual([{ code: 'VIDEOGRAPHER', quantity: 1 }]);
  });

  it('rejects an add-on the platform does not sell', () => {
    expect(AddonCode.safeParse('VIDEO_ONLY').success).toBe(false);
  });
});

describe('AdminPricingPreviewQuery', () => {
  it('lets staff preview every add-on at once, videographer included', () => {
    const parsed = AdminPricingPreviewQuery.safeParse({
      tier: 'EXPERT',
      categoryCode: 'WEDDING',
      cityId: '0b6f3c1e-7a4d-4c5e-9f8a-1d2e3f4a5b6c',
      hours: '3',
      scheduledStart: '2027-03-16T11:00:00+05:30',
      addons: AddonCode.options.join(','),
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.addons).toEqual([...AddonCode.options]);
  });
});
