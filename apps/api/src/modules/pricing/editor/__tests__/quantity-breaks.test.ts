import type { PricingAddonPriceRow } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { risingQuantityBreak } from '../quantity-breaks';

const row = (
  minQuantity: number,
  amountPaise: number,
  over: Partial<PricingAddonPriceRow> = {},
): PricingAddonPriceRow => ({
  id: `00000000-0000-4000-8000-${String(minQuantity * 1000 + amountPaise / 100).padStart(12, '0')}`,
  addonCode: 'REELS',
  addonName: 'Reels',
  tier: null,
  cityTier: null,
  minQuantity,
  amountPaise,
  isPerHour: false,
  payoutShareBps: 6000,
  ...over,
});

describe('risingQuantityBreak (ADR-0034: more units never cost more each)', () => {
  it('accepts the launch reels card: ₹3,000, then ₹2,000 from 5', () => {
    expect(risingQuantityBreak([row(1, 300_000), row(5, 200_000)])).toBeNull();
  });

  it('accepts an equal price at a higher break', () => {
    expect(risingQuantityBreak([row(5, 200_000), row(1, 200_000)])).toBeNull();
  });

  it('finds a break priced above a lower one, whatever the row order', () => {
    const bad = row(5, 350_000);
    expect(risingQuantityBreak([bad, row(1, 300_000)])).toEqual(bad);
  });

  it('compares only rows of the same add-on, tier and city tier', () => {
    expect(
      risingQuantityBreak([
        row(1, 300_000),
        row(5, 350_000, { tier: 'EXPERT' }),
        row(5, 350_000, { addonCode: 'OTHER' }),
      ]),
    ).toBeNull();
  });
});
