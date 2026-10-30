import { describe, expect, it } from 'vitest';
import {
  formatIstDate,
  formatIstExact,
  formatIstWeekdayDate,
  formatRelative,
} from './relative-time.js';

/** Thu 30 Oct 2026, 3:00 pm IST. */
const NOW = Date.parse('2026-10-30T09:30:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelative (ADR-0026 D8)', () => {
  it.each([
    [0, 'just now'],
    [-30_000, 'just now'],
    [20 * MIN, 'in 20 min'],
    [-5 * MIN, '5 min ago'],
    [75 * MIN, 'in 75 min'],
    [2 * HOUR, 'in 2 h'],
    [-3 * HOUR - 10 * MIN, '3 h ago'],
    [30 * HOUR, 'in 30 h'],
    [-2 * DAY, '2 days ago'],
    [DAY + 13 * HOUR, 'in 2 days'],
    [-6 * DAY, '6 days ago'],
  ])('%i ms from now reads "%s"', (offset, text) => {
    expect(formatRelative(NOW + offset, NOW)).toBe(text);
  });

  it('shows the IST date beyond a week, and accepts ISO strings and dates', () => {
    expect(formatRelative(NOW - 10 * DAY, NOW)).toBe('20 Oct');
    expect(formatRelative('2026-10-30T11:30:00.000Z', NOW)).toBe('in 2 h');
    expect(formatRelative(new Date(NOW + 2 * HOUR), NOW)).toBe('in 2 h');
    expect(formatRelative('not a date', NOW)).toBe('');
  });
});

describe('exact IST times', () => {
  it('formats in IST whatever the zone, 12-hour with am/pm', () => {
    expect(formatIstExact(NOW)).toBe('Fri, 30 Oct 2026, 3:00 pm IST');
    // 7:00 pm UTC on the 30th is 12:30 am IST on the 31st.
    expect(formatIstExact('2026-10-30T19:00:00.000Z')).toBe('Sat, 31 Oct 2026, 12:30 am IST');
    expect(formatIstDate('2026-09-14T11:00:00.000Z')).toBe('14 Sep');
    expect(formatIstWeekdayDate(NOW)).toBe('Fri, 30 Oct');
  });
});
