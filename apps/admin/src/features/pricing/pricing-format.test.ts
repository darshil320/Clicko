import { describe, expect, it } from 'vitest';
import {
  bpsToFactor,
  bpsToPercentText,
  changeOf,
  factorToBps,
  paiseToRupeesText,
  parseRupees,
  percentTextToBps,
  publishSentence,
  upliftLabel,
} from './pricing-format';

describe('parseRupees (₹ typed by a person → integer paise, no floats)', () => {
  it('accepts grouping, a ₹ sign and up to two decimals', () => {
    expect(parseRupees('4250')).toBe(425000);
    expect(parseRupees('₹4,250')).toBe(425000);
    expect(parseRupees(' 1,20,000.5 ')).toBe(12000050);
    expect(parseRupees('0.07')).toBe(7);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1e5', '4250..', '₹']) {
      expect(parseRupees(bad), bad).toBeNull();
    }
  });

  it('renders paise back for the input', () => {
    expect(paiseToRupeesText(425000)).toBe('4250');
    expect(paiseToRupeesText(12000050)).toBe('120000.50');
  });
});

describe('percentages and factors (basis points)', () => {
  it('a share in % ↔ bps', () => {
    expect(percentTextToBps('62')).toBe(6200);
    expect(percentTextToBps('62.5%')).toBe(6250);
    expect(percentTextToBps('100')).toBe(10000);
    expect(percentTextToBps('62.555')).toBeNull();
    expect(bpsToPercentText(6250)).toBe('62.5');
  });

  it('a price factor 1.15× ↔ 11500 bps', () => {
    expect(factorToBps('1.15')).toBe(11500);
    expect(factorToBps('1.15×')).toBe(11500);
    expect(factorToBps('2')).toBe(20000);
    expect(factorToBps('1.1234')).toBeNull();
    expect(bpsToFactor(11500)).toBe('1.15×');
    expect(bpsToFactor(10000)).toBe('1.00×');
  });

  it('an uplift reads as plain language', () => {
    expect(upliftLabel(11500)).toBe('+15%');
    expect(upliftLabel(10000)).toBe('No change');
    expect(upliftLabel(9000)).toBe('−10%');
  });
});

describe('changeOf (the review: ₹ before → after, % change)', () => {
  it('reports direction and the percentage to one decimal', () => {
    expect(changeOf(425000, 450000)).toEqual({ direction: 'up', percent: '+5.9%', large: false });
    expect(changeOf(450000, 300000)).toEqual({
      direction: 'down',
      percent: '−33.3%',
      large: true,
    });
    expect(changeOf(0, 100)).toEqual({ direction: 'up', percent: null, large: true });
    expect(changeOf(100, 100)).toEqual({ direction: 'same', percent: '0%', large: false });
  });
});

describe('publishSentence (what the publish dialog promises)', () => {
  const now = Date.parse('2026-10-30T10:30:00+05:30');
  it('now', () => {
    expect(publishSentence({ version: '2026.10.30', at: null, now })).toBe(
      'New bookings from now on use version 2026.10.30. Existing bookings keep their price, and quotes already shown stay valid until they expire (15 minutes).',
    );
  });

  it('later today and another day', () => {
    expect(
      publishSentence({ version: '2026.10.30', at: Date.parse('2026-10-30T16:30:00+05:30'), now }),
    ).toContain('New bookings from 4:30 pm today use version 2026.10.30.');
    expect(
      publishSentence({ version: '2026.11.01', at: Date.parse('2026-11-01T00:00:00+05:30'), now }),
    ).toContain('New bookings from 1 Nov, 12:00 am use version 2026.11.01.');
  });
});
