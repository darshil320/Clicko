import { describe, expect, it } from 'vitest';
import {
  financialYearFromLabel,
  financialYearOf,
  isIstMonday,
  istDate,
  istMonth,
  istWeekStart,
  monthRange,
  monthsOf,
  tdsDepositDueOn,
} from '../rules/ist-calendar';

describe('IST calendar for payouts', () => {
  it('the week starts Monday 00:00 IST (Sunday 18:30 UTC)', () => {
    // Mon 2 Nov 2026, 00:10 IST = Sun 1 Nov 18:40 UTC
    const mondayEarly = new Date('2026-11-01T18:40:00.000Z');
    expect(istWeekStart(mondayEarly).toISOString()).toBe('2026-11-01T18:30:00.000Z');
    expect(isIstMonday(mondayEarly)).toBe(true);
    // Sun 1 Nov 2026, 23:50 IST
    const sundayLate = new Date('2026-11-01T18:20:00.000Z');
    expect(isIstMonday(sundayLate)).toBe(false);
    expect(istWeekStart(sundayLate).toISOString()).toBe('2026-10-25T18:30:00.000Z');
  });

  it('dates and months are IST', () => {
    expect(istDate(new Date('2026-10-31T19:00:00.000Z'))).toBe('2026-11-01');
    expect(istMonth(new Date('2026-10-31T19:00:00.000Z'))).toBe('2026-11');
    expect(monthRange('2026-11')).toEqual({
      start: new Date('2026-10-31T18:30:00.000Z'),
      end: new Date('2026-11-30T18:30:00.000Z'),
    });
    expect(monthRange('2026-12').end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
  });

  it('the financial year turns at 1 April 00:00 IST', () => {
    expect(financialYearOf(new Date('2027-03-31T18:29:59.999Z')).label).toBe('2026-27');
    const next = financialYearOf(new Date('2027-03-31T18:30:00.000Z'));
    expect(next).toEqual({
      label: '2027-28',
      start: new Date('2027-03-31T18:30:00.000Z'),
      end: new Date('2028-03-31T18:30:00.000Z'),
    });
    expect(financialYearFromLabel('2026-27')).toEqual(
      financialYearOf(new Date('2026-10-30T00:00:00.000Z')),
    );
    expect(financialYearFromLabel('1999-00').label).toBe('1999-00');
  });

  it('a financial year has twelve months, April to March', () => {
    const months = monthsOf(financialYearFromLabel('2026-27'));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[11]).toBe('2027-03');
  });

  it('TDS is deposited by the 7th of the next month; March by 30 April', () => {
    expect(tdsDepositDueOn('2026-11')).toBe('2026-12-07');
    expect(tdsDepositDueOn('2026-12')).toBe('2027-01-07');
    expect(tdsDepositDueOn('2027-03')).toBe('2027-04-30');
  });
});
