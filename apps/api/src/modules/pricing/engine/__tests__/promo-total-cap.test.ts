import { describe, expect, it } from 'vitest';
import { computeQuote } from '../index';
import { launch, quoteRequest } from './fixtures';

const promo = {
  code: 'LAUNCH50',
  discountBps: null,
  discountFlatPaise: 5000n,
  maxDiscountPaise: null,
  minBookingPaise: 0n,
  appliesToTiers: null,
  appliesToCityIds: null,
  firstBookingOnly: false,
  perUserCap: 1,
  validFrom: new Date('2026-01-01T00:00:00Z'),
  validTo: new Date('2028-01-01T00:00:00Z'),
  isActive: true,
  userRedemptions: 0,
  userBookingCount: 0,
};

describe('promo total redemption cap (promo_codes.total_redemption_cap)', () => {
  it('applies while redemptions are below the cap', () => {
    const r = computeQuote(
      quoteRequest({ promo: { ...promo, totalRedemptionCap: 100, totalRedemptions: 99 } }),
      launch(),
    );
    expect(r.kind).toBe('QUOTE');
  });

  it('rejects once the cap is reached', () => {
    const r = computeQuote(
      quoteRequest({ promo: { ...promo, totalRedemptionCap: 100, totalRedemptions: 100 } }),
      launch(),
    );
    expect(r).toMatchObject({ kind: 'REJECTED', code: 'PROMO_USAGE_EXCEEDED' });
  });

  it('treats a null cap as unlimited', () => {
    const r = computeQuote(
      quoteRequest({ promo: { ...promo, totalRedemptionCap: null, totalRedemptions: 10_000 } }),
      launch(),
    );
    expect(r.kind).toBe('QUOTE');
  });
});
