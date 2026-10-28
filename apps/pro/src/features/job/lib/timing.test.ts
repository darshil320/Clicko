import { describe, expect, it } from 'vitest';
import {
  billingStartsAt,
  clientAbsentOpensAt,
  earliestCheckOutAt,
  formatAt,
  formatCountdown,
  formatElapsed,
  opensAt,
  uploadDeadlineAt,
} from './timing';

// 4:30 pm IST on 14 Nov 2026.
const START = '2026-11-14T11:00:00.000Z';
const MIN = 60_000;

describe('opensAt (ADR-0013 D2)', () => {
  it('opens en-route and check-in 3 hours before the scheduled start', () => {
    expect(opensAt(START)).toBe('2026-11-14T08:00:00.000Z');
  });
});

describe('billingStartsAt (ADR-0013 D6)', () => {
  it('an early photographer does not start the clock before the scheduled start', () => {
    expect(billingStartsAt('2026-11-14T10:40:00.000Z', START)).toBe(START);
  });

  it('a late photographer is billed from their check-in', () => {
    expect(billingStartsAt('2026-11-14T11:12:00.000Z', START)).toBe('2026-11-14T11:12:00.000Z');
  });

  it('accepts ISO strings with an offset', () => {
    expect(billingStartsAt('2026-11-14T16:45:00+05:30', START)).toBe('2026-11-14T11:15:00.000Z');
  });
});

describe('earliestCheckOutAt (ADR-0013 D6)', () => {
  it('is the billing start plus the booked hours', () => {
    expect(earliestCheckOutAt(START, 2, 0)).toBe('2026-11-14T13:00:00.000Z');
  });

  it('adds one hour per approved extension', () => {
    expect(earliestCheckOutAt(START, 2, 2)).toBe('2026-11-14T15:00:00.000Z');
  });

  it('handles half hours', () => {
    expect(earliestCheckOutAt(START, 1.5, 0)).toBe('2026-11-14T12:30:00.000Z');
  });
});

describe('clientAbsentOpensAt (ADR-0013 D12)', () => {
  it('is 60 minutes after the billing start', () => {
    expect(clientAbsentOpensAt(START)).toBe('2026-11-14T12:00:00.000Z');
  });
});

describe('uploadDeadlineAt', () => {
  it('is the check-out plus the upload window (6 h)', () => {
    expect(uploadDeadlineAt('2026-11-14T13:05:00.000Z')).toBe('2026-11-14T19:05:00.000Z');
  });
});

describe('formatElapsed', () => {
  it('shows hours and minutes', () => {
    expect(formatElapsed(107 * MIN)).toBe('1h 47m');
  });

  it('pads nothing and drops the hour under 60 minutes', () => {
    expect(formatElapsed(47 * MIN + 59_000)).toBe('47m');
  });

  it('shows whole hours with 0m', () => {
    expect(formatElapsed(120 * MIN)).toBe('2h 0m');
  });

  it('never goes negative', () => {
    expect(formatElapsed(-5 * MIN)).toBe('0m');
  });
});

describe('formatCountdown', () => {
  it('shows m:ss under an hour', () => {
    expect(formatCountdown(23 * MIN + 4_000)).toBe('23:04');
  });

  it('rounds a part second up so it never reads 0:00 early', () => {
    expect(formatCountdown(500)).toBe('0:01');
  });

  it('shows hours and padded minutes from an hour up', () => {
    expect(formatCountdown(65 * MIN)).toBe('1h 05m');
  });

  it('is 0:00 once due', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3_000)).toBe('0:00');
  });
});

describe('formatAt', () => {
  const now = new Date('2026-11-14T06:00:00.000Z'); // 11:30 am IST, 14 Nov

  it('is just the time on the same IST day', () => {
    expect(formatAt(START, now)).toBe('4:30 pm');
  });

  it('adds the date on another IST day', () => {
    expect(formatAt('2026-11-15T04:00:00.000Z', now)).toBe('15 Nov, 9:30 am');
  });
});
