import { describe, expect, it } from 'vitest';
import {
  BASIS,
  count,
  istToday,
  maskedAccount,
  monthLabel,
  percent,
  releaseConsequence,
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

  it('withheld payouts: the basis in words and what releasing does (ADR-0027 D5)', () => {
    expect(BASIS.DATA_LOSS).toBe('Files lost');
    expect(BASIS.ACCESS_DENIED).toBe('Access denied');
    expect(BASIS.CLIENT_ABSENT).toBe("Client didn't attend");
    // A client's late cancellation: the photographer's share of what was kept (addendum 0019).
    expect(BASIS.CLIENT_CANCELLED).toBe('Client cancelled late');
    expect(BASIS.DELIVERED).toBe('Delivered');
    expect(releaseConsequence(520_000, 'Asha Patel')).toBe(
      '₹5,200 will be paid to Asha Patel in the next batch, with TDS and any deductions worked out there as usual.',
    );
  });
});
