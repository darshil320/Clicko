import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatCode,
  formatCountdown,
  formatDate,
  formatDateTime,
  formatDuration,
  initials,
} from './format';

describe('formatDateTime — DD MMM, 12-hour time in India time (DESIGN.md content rules)', () => {
  it('shows a UTC instant in IST with a lower-case am/pm', () => {
    // 11:00 UTC = 4:30 pm IST
    expect(formatDateTime(Date.UTC(2026, 8, 14, 11, 0))).toBe('14 Sep, 4:30 pm');
  });

  it('accepts an ISO string', () => {
    expect(formatDateTime('2026-09-14T03:15:00.000Z')).toBe('14 Sep, 8:45 am');
  });

  it('renders midnight and noon as 12', () => {
    expect(formatDateTime(Date.UTC(2026, 0, 1, 18, 30))).toBe('2 Jan, 12:00 am');
    expect(formatDateTime(Date.UTC(2026, 0, 1, 6, 30))).toBe('1 Jan, 12:00 pm');
  });

  it('uses Sep, never Sept', () => {
    expect(formatDate(Date.UTC(2026, 8, 3, 6, 0))).toBe('3 Sep');
  });
});

describe('formatCode', () => {
  it('turns an enum code into words', () => {
    expect(formatCode('SEMI_PRO')).toBe('Semi Pro');
    expect(formatCode('FOOD')).toBe('Food');
  });
});

describe('initials', () => {
  it('takes the first letter of the first two names', () => {
    expect(initials('Vikram Reddy')).toBe('VR');
    expect(initials('  ananya  ')).toBe('A');
    expect(initials('Priya Sharma Iyer')).toBe('PS');
  });

  it('falls back when the name is empty', () => {
    expect(initials('')).toBe('?');
  });
});

describe('existing formatters', () => {
  it('formats bytes, durations and countdowns', () => {
    expect(formatBytes(18.4 * 1024 ** 3)).toBe('18.4 GB');
    expect(formatDuration(725)).toBe('12:05');
    expect(formatCountdown(4 * 3_600_000 + 12 * 60_000, 0)).toEqual({
      text: '4 h 12 min left',
      overdue: false,
    });
    expect(formatCountdown(0, 25 * 60_000)).toEqual({ text: 'Overdue by 25 min', overdue: true });
  });
});
