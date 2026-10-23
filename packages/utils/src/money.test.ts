import { describe, expect, it } from 'vitest';
import { ceilHalf, formatINR, fromPaiseBigint, roundHalfUp, toPaiseBigint } from './money.js';

describe('roundHalfUp', () => {
  it('returns an exact quotient unchanged', () => {
    expect(roundHalfUp(850000n, 1n)).toBe(850000n);
    expect(roundHalfUp(100n, 10n)).toBe(10n);
  });

  it('rounds exactly half up, not to even', () => {
    expect(roundHalfUp(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(roundHalfUp(15n, 10n)).toBe(2n); // 1.5 → 2
    expect(roundHalfUp(25n, 10n)).toBe(3n); // 2.5 → 3 (banker's would give 2)
  });

  it('rounds just below half down and just above half up', () => {
    expect(roundHalfUp(1049n, 1000n)).toBe(1n);
    expect(roundHalfUp(1051n, 1000n)).toBe(1n);
    expect(roundHalfUp(1499n, 1000n)).toBe(1n);
    expect(roundHalfUp(1500n, 1000n)).toBe(2n);
  });

  it('computes 18% GST on ₹8,500 as ₹1,530 exactly', () => {
    expect(roundHalfUp(850000n * 1800n, 10000n)).toBe(153000n);
  });

  it('handles the doc 05 base-amount expression without overflow at 12h Signature-scale rates', () => {
    const rate = 5_000_000n; // ₹50,000/hr
    const numerator = rate * 120n * 12500n * 22000n * 12500n * 12500n * 11000n;
    const denominator = 10n * 10000n ** 5n;
    expect(roundHalfUp(numerator, denominator)).toBe(283_593_750n);
  });

  it('rejects a zero or negative denominator', () => {
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => roundHalfUp(1n, -5n)).toThrow(RangeError);
  });

  it('rejects a negative numerator rather than rounding it the wrong way', () => {
    expect(() => roundHalfUp(-5n, 2n)).toThrow(RangeError);
  });
});

describe('ceilHalf', () => {
  it('splits an even total exactly in two', () => {
    expect(ceilHalf(1003000n)).toBe(501500n);
  });

  it('gives the odd paise to the advance so advance + balance = total', () => {
    const total = 1690823n;
    const advance = ceilHalf(total);
    expect(advance).toBe(845412n);
    expect(advance + (total - advance)).toBe(total);
  });

  it('rejects a negative total', () => {
    expect(() => ceilHalf(-1n)).toThrow(RangeError);
  });
});

describe('formatINR', () => {
  it('formats with Indian lakh grouping', () => {
    expect(formatINR(12000000n)).toBe('₹1,20,000');
    expect(formatINR(850000n)).toBe('₹8,500');
    expect(formatINR(0n)).toBe('₹0');
  });

  it('groups thousands, lakhs and crores without Intl', () => {
    expect(formatINR(99900n)).toBe('₹999');
    expect(formatINR(100000n)).toBe('₹1,000');
    expect(formatINR(1000000n)).toBe('₹10,000');
    expect(formatINR(1200000000n)).toBe('₹1,20,00,000');
    expect(formatINR(10000000000n)).toBe('₹10,00,00,000');
    expect(formatINR(1200000050n, { showPaise: true })).toBe('₹1,20,00,000.50');
  });

  it('accepts a safe-integer number of paise', () => {
    expect(formatINR(1003000)).toBe('₹10,030');
  });

  it('hides paise by default and shows them when asked', () => {
    expect(formatINR(1690822n)).toBe('₹16,908');
    expect(formatINR(1690822n, { showPaise: true })).toBe('₹16,908.22');
    expect(formatINR(1690805n, { showPaise: true })).toBe('₹16,908.05');
  });

  it('rounds to the rupee half-up for display', () => {
    expect(formatINR(1690850n)).toBe('₹16,909');
    expect(formatINR(1690849n)).toBe('₹16,908');
  });

  it('formats a negative amount with the sign before the symbol', () => {
    expect(formatINR(-20000n)).toBe('-₹200');
  });

  it('rejects a non-integer number', () => {
    expect(() => formatINR(85.5)).toThrow(TypeError);
  });
});

describe('paise conversion at the API boundary', () => {
  it('round-trips a safe integer', () => {
    expect(fromPaiseBigint(toPaiseBigint(850000))).toBe(850000);
  });

  it('refuses to convert a fractional number', () => {
    expect(() => toPaiseBigint(0.1)).toThrow(TypeError);
  });

  it('refuses to narrow a bigint beyond the safe-integer range', () => {
    expect(() => fromPaiseBigint(2n ** 53n)).toThrow(RangeError);
  });
});
