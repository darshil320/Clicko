import { describe, expect, it } from 'vitest';
import { parseRupees, rupeesInput } from './money-labels';

describe('parseRupees / rupeesInput', () => {
  it('reads rupees with Indian grouping, a ₹ sign and up to two decimals', () => {
    expect(parseRupees('2,500')).toBe(250_000);
    expect(parseRupees('₹ 1,20,000.5')).toBe(12_000_050);
    expect(parseRupees('84.11')).toBe(8_411);
    expect(parseRupees('0')).toBe(0);
  });

  it('refuses anything that is not an amount', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1e3']) expect(parseRupees(bad)).toBeNull();
  });

  it('round-trips an amount for an input field', () => {
    expect(rupeesInput(250_050)).toBe('2500.50');
    expect(rupeesInput(250_000)).toBe('2500');
    expect(parseRupees(rupeesInput(845_411))).toBe(845_411);
  });
});
