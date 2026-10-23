import { describe, expect, it } from 'vitest';
import { CATEGORY_UPLIFT_BPS } from '../content/rate-card';
import { formatRupees } from './money';
import {
  categoryFromPrices,
  fromPrice,
  multiplierLabel,
  percentAbove,
  toCardData,
} from './pricing';

const headline = (cityTier: 'METRO' | 'TIER_1') =>
  categoryFromPrices(cityTier).map((p) => formatRupees(p.basePaise));

describe('2-hour "from" prices (doc 05 §5 launch rate card)', () => {
  it('Surat and Vadodara (TIER_1): Basic ₹3,500 · Semi-Pro ₹5,500 · Professional ₹8,500 · Expert ₹14,000', () => {
    expect(headline('TIER_1')).toEqual(['₹3,500', '₹5,500', '₹8,500', '₹14,000']);
  });

  it('Mumbai (METRO): Basic ₹4,000 · Semi-Pro ₹6,400 · Professional ₹10,000 · Expert ₹16,400', () => {
    expect(headline('METRO')).toEqual(['₹4,000', '₹6,400', '₹10,000', '₹16,400']);
  });

  it('adds 18% GST exclusive: ₹8,500 + ₹1,530 = ₹10,030 (doc 05 §6)', () => {
    const pro = fromPrice('PROFESSIONAL', 'TIER_1');
    expect(pro.gstPaise).toBe(153_000n);
    expect(pro.totalPaise).toBe(1_003_000n);
  });

  it('applies the category uplift once, before GST', () => {
    const food = fromPrice('BASIC', 'TIER_1', CATEGORY_UPLIFT_BPS.FOOD);
    expect(food.basePaise).toBe(402_500n);
    expect(food.gstPaise).toBe(72_450n);
    expect(formatRupees(food.totalPaise)).toBe('₹4,749.50');
    const wedding = fromPrice('EXPERT', 'METRO', CATEGORY_UPLIFT_BPS.WEDDING);
    expect(formatRupees(wedding.basePaise)).toBe('₹20,500');
  });

  it('prices an extra hour at base hourly × uplift (doc 05 extension_rates)', () => {
    expect(fromPrice('PROFESSIONAL', 'TIER_1').extraHourPaise).toBe(425_000n);
    expect(fromPrice('PROFESSIONAL', 'METRO', CATEGORY_UPLIFT_BPS.CORPORATE).extraHourPaise).toBe(
      600_000n,
    );
  });

  it('refuses durations under the 2-hour minimum and fractional uplifts', () => {
    expect(() => fromPrice('BASIC', 'TIER_1', 10_000, 1)).toThrow(RangeError);
    expect(() => fromPrice('BASIC', 'TIER_1', 9_000)).toThrow(RangeError);
  });

  it('produces serialisable card strings', () => {
    expect(toCardData(fromPrice('EXPERT', 'METRO'))).toEqual({
      tier: 'EXPERT',
      base: '₹16,400',
      total: '₹19,352',
      extraHour: '₹8,200',
      hours: 2,
    });
  });
});

describe('multiplier labels', () => {
  it.each([
    [10_000, 'standard', '1×'],
    [11_500, '+15%', '1.15×'],
    [12_000, '+20%', '1.2×'],
    [22_000, '+120%', '2.2×'],
    [12_500, '+25%', '1.25×'],
  ])('%i bps → %s / %s', (bps, percent, label) => {
    expect(percentAbove(bps)).toBe(percent);
    expect(multiplierLabel(bps)).toBe(label);
  });
});
