import { describe, expect, it } from 'vitest';
import {
  count,
  istToday,
  maskedAccount,
  monthLabel,
  percent,
  rupees,
  rupeesExact,
  toPhotographers,
} from './labels';

describe('payouts desk labels', () => {
  it('money in rupees with Indian grouping, from number or bigint paise', () => {
    expect(rupees(12_456_000)).toBe('₹1,24,560');
    expect(rupees(12_456_000n)).toBe('₹1,24,560');
    expect(rupeesExact(3_560_050n)).toBe('₹35,600.50');
  });

  it('the confirm line states the money and the people', () => {
    expect(toPhotographers(12_456_000n, 18)).toBe('₹1,24,560 to 18 photographers');
    expect(toPhotographers(200_000, 1)).toBe('₹2,000 to 1 photographer');
    expect(count(1_200, 'payout')).toBe('1,200 payouts');
  });

  it('percentages, masked accounts, months and the IST day', () => {
    expect(percent(100)).toBe('1%');
    expect(percent(2_000)).toBe('20%');
    expect(maskedAccount({ bankName: 'HDFC Bank', last4: '7890' })).toBe('HDFC Bank ···· 7890');
    expect(maskedAccount({ bankName: null, last4: '7890' })).toBe('···· 7890');
    expect(monthLabel('2026-12')).toBe('December 2026');
    expect(istToday(Date.parse('2026-12-06T19:00:00Z'))).toBe('2026-12-07');
  });
});
