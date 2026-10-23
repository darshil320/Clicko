import { describe, expect, it } from 'vitest';
import { invoiceSeriesFor } from '../financial-year';

describe('invoiceSeriesFor (Indian financial year, IST)', () => {
  it('puts November 2026 in FY 2026-27', () => {
    expect(invoiceSeriesFor(new Date('2026-11-10T06:30:00Z'))).toEqual({
      code: 'CLK-INV',
      financialYear: '2026-27',
      prefix: 'CLK/26-27/',
    });
  });

  it('puts January to March in the year that started the previous April', () => {
    expect(invoiceSeriesFor(new Date('2027-03-31T18:29:59Z')).financialYear).toBe('2026-27');
  });

  it('rolls over at midnight IST on 1 April, not midnight UTC', () => {
    // 2027-03-31T18:30Z is 2027-04-01 00:00 IST.
    expect(invoiceSeriesFor(new Date('2027-03-31T18:30:00Z'))).toMatchObject({
      financialYear: '2027-28',
      prefix: 'CLK/27-28/',
    });
  });

  it('formats the century rollover with two digits', () => {
    expect(invoiceSeriesFor(new Date('2099-06-01T00:00:00Z'))).toMatchObject({
      financialYear: '2099-00',
      prefix: 'CLK/99-00/',
    });
  });
});
