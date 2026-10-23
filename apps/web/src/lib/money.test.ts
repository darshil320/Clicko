import { describe, expect, it } from 'vitest';
import { decimalRupees, formatRupees, groupIndian, roundHalfUp, rupeesToPaise } from './money';

describe('roundHalfUp', () => {
  it('rounds exactly half up, never to even', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n);
    expect(roundHalfUp(25n, 10n)).toBe(3n);
    expect(roundHalfUp(24n, 10n)).toBe(2n);
  });

  it('computes 18% GST on ₹8,500 as ₹1,530 exactly', () => {
    expect(roundHalfUp(850_000n * 1_800n, 10_000n)).toBe(153_000n);
  });

  it('rejects a non-positive denominator', () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('groupIndian', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['10000', '10,000'],
    ['120000', '1,20,000'],
    ['1200000', '12,00,000'],
    ['120000000', '12,00,00,000'],
  ])('%s → %s', (input, expected) => {
    expect(groupIndian(input)).toBe(expected);
  });

  it('rejects anything that is not digits', () => {
    expect(() => groupIndian('12.5')).toThrow(RangeError);
  });
});

describe('formatRupees', () => {
  it('formats paise as Indian-grouped rupees', () => {
    expect(formatRupees(350_000n)).toBe('₹3,500');
    expect(formatRupees(1_003_000n)).toBe('₹10,030');
    expect(formatRupees(12_000_000n)).toBe('₹1,20,000');
  });

  it('shows paise only when they are non-zero, without rounding them away', () => {
    expect(formatRupees(474_950n)).toBe('₹4,749.50');
    expect(formatRupees(100_005n)).toBe('₹1,000.05');
  });

  it('handles zero and negatives', () => {
    expect(formatRupees(0n)).toBe('₹0');
    expect(formatRupees(-50_000n)).toBe('-₹500');
  });
});

describe('decimalRupees', () => {
  it('renders the schema.org decimal form', () => {
    expect(decimalRupees(402_500n)).toBe('4025.00');
    expect(decimalRupees(474_950n)).toBe('4749.50');
    expect(() => decimalRupees(-1n)).toThrow(RangeError);
  });
});

describe('rupeesToPaise', () => {
  it('converts whole rupees only', () => {
    expect(rupeesToPaise(1_750)).toBe(175_000n);
    expect(() => rupeesToPaise(17.5)).toThrow(RangeError);
  });
});
