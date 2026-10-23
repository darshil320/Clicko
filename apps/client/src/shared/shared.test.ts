import { ApiError } from '@clickco/api-client';
import type { BookingStatus, BookingSummary } from '@clickco/contracts';
import { BookingStatus as BookingStatuses } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import {
  canCancel,
  isFinished,
  isHalted,
  journey,
  splitBookings,
  statusPresentation,
} from './booking-status';
import { categoryLabel, eligibleAddons, isBookableTier } from './catalogue';
import { userMessage } from './errors';
import {
  addDays,
  formatDateTime,
  formatDayMonth,
  formatHours,
  formatShootWindow,
  formatTime,
  formatTimeRange,
  istDateKey,
  istIso,
  istParts,
} from './format/datetime';
import { formatPhone } from './format/phone';
import { shouldRetry } from './query';

describe('IST date/time formatting', () => {
  it('converts any instant to IST wall-clock', () => {
    const instant = new Date('2026-11-14T11:00:00Z'); // 4:30 pm IST
    expect(istParts(instant)).toMatchObject({ year: 2026, month: 11, day: 14, minuteOfDay: 990 });
    expect(istDateKey(new Date('2026-11-14T19:00:00Z'))).toBe('2026-11-15'); // 00:30 IST next day
  });

  it('builds an offset ISO instant from a date key and minute', () => {
    expect(istIso('2026-11-14', 990)).toBe('2026-11-14T16:30:00+05:30');
    expect(Date.parse(istIso('2026-11-14', 990))).toBe(Date.parse('2026-11-14T11:00:00Z'));
    expect(() => istIso('2026-11-14', 1440)).toThrow(RangeError);
    expect(() => istIso('14/11/2026', 60)).toThrow(RangeError);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('formats DD MMM and 12-hour times with am/pm', () => {
    expect(formatDayMonth('2026-09-14')).toBe('14 Sep');
    expect(formatTime(990)).toBe('4:30 pm');
    expect(formatTime(0)).toBe('12:00 am');
    expect(formatTime(720)).toBe('12:00 pm');
    expect(formatTime(9 * 60 + 5)).toBe('9:05 am');
  });

  it('formats a shoot window, naming am/pm twice only across noon', () => {
    expect(formatTimeRange(990, 2)).toBe('4:30–6:30 pm');
    expect(formatTimeRange(690, 2)).toBe('11:30 am–1:30 pm');
    expect(formatTimeRange(1260, 2.5)).toBe('9:00–11:30 pm');
    expect(formatShootWindow('2026-09-14T11:00:00Z', 2)).toBe('14 Sep, 4:30–6:30 pm');
    expect(formatDateTime('2026-09-14T16:30:00+05:30')).toBe('14 Sep, 4:30 pm');
  });

  it('formats durations', () => {
    expect(formatHours(2)).toBe('2 hours');
    expect(formatHours(2.5)).toBe('2.5 hours');
    expect(formatHours(1)).toBe('1 hour');
  });

  it('formats Indian mobile numbers', () => {
    expect(formatPhone('+919800000777')).toBe('+91 98000 00777');
    expect(formatPhone('not-a-phone')).toBe('not-a-phone');
  });
});

describe('catalogue', () => {
  it('labels categories, including codes it does not know yet', () => {
    expect(categoryLabel('REAL_ESTATE')).toBe('Real Estate');
    expect(categoryLabel('PRE_WEDDING')).toBe('Pre Wedding');
  });

  it('gates add-ons by tier and Signature is not instantly bookable', () => {
    expect(eligibleAddons('BASIC')).toEqual([]);
    expect(eligibleAddons('EXPERT').map((a) => a.code)).toContain('DRONE');
    expect(isBookableTier('SIGNATURE')).toBe(false);
    expect(isBookableTier('EXPERT')).toBe(true);
  });
});

const summary = (status: BookingStatus, scheduledStart: string, id: string): BookingSummary => ({
  id,
  reference: `CLK-${id}`,
  status,
  tier: 'PROFESSIONAL',
  categoryCode: 'FOOD',
  cityName: 'Surat',
  scheduledStart,
  scheduledHours: 2,
  emergencyBand: 'NONE',
  venueAddress: '14, Rajhans Platinum, Vesu, Surat',
  totalPaise: 1003000,
  advancePaise: 501500,
  balancePaise: 501500,
  amountPaidPaise: 0,
  quoteExpiresAt: null,
  createdAt: '2026-11-01T10:00:00+05:30',
});

describe('booking status presentation', () => {
  it('has client wording and a tone for every status', () => {
    for (const status of BookingStatuses.options) {
      const p = statusPresentation(status);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.label).not.toMatch(/_/);
    }
    expect(statusPresentation('ASSIGNED')).toEqual({
      label: 'Photographer assigned',
      tone: 'accent',
    });
    expect(statusPresentation('CONFIRMED')).toEqual({
      label: 'Awaiting assignment',
      tone: 'warning',
    });
  });

  it('lets the client cancel only before payment lands', () => {
    expect(canCancel('QUOTED')).toBe(true);
    expect(canCancel('ADVANCE_PENDING')).toBe(true);
    expect(canCancel('CONFIRMED')).toBe(false);
  });

  it('splits upcoming (soonest first) from past (latest first) without mutating', () => {
    const list = [
      summary('DELIVERED', '2026-10-01T10:00:00+05:30', '1'),
      summary('CONFIRMED', '2026-11-20T10:00:00+05:30', '2'),
      summary('QUOTED', '2026-11-15T10:00:00+05:30', '3'),
      summary('CANCELLED_CLIENT', '2026-10-20T10:00:00+05:30', '4'),
    ];
    const before = list.map((b) => b.id);
    const { upcoming, past } = splitBookings(list);
    expect(upcoming.map((b) => b.id)).toEqual(['3', '2']);
    expect(past.map((b) => b.id)).toEqual(['4', '1']);
    expect(list.map((b) => b.id)).toEqual(before);
    expect(isFinished('CLOSED')).toBe(true);
    expect(isHalted('DELIVERED')).toBe(false);
  });

  it('walks the four-step journey', () => {
    const states = (status: BookingStatus) => journey(status).map((s) => s.state);
    expect(states('ADVANCE_PENDING')).toEqual(['current', 'upcoming', 'upcoming', 'upcoming']);
    expect(states('CONFIRMED')).toEqual(['done', 'current', 'upcoming', 'upcoming']);
    expect(states('EN_ROUTE')).toEqual(['done', 'done', 'current', 'upcoming']);
    expect(states('BALANCE_PENDING')).toEqual(['done', 'done', 'done', 'current']);
    expect(states('DELIVERED')).toEqual(['done', 'done', 'done', 'done']);
    expect(journey('DELIVERED').at(-1)?.label).toBe('Photos delivered');
    expect(journey('CONFIRMED').map((s) => s.label)).toEqual([
      'Booked',
      'Photographer assigned',
      'Shoot day',
      'Photos in 48 hours',
    ]);
  });
});

describe('errors and retries', () => {
  const http = (status: number, message = 'This quote has expired — please start a new booking') =>
    new ApiError({ kind: 'HTTP', status, code: 'X', message });

  it('passes the API sentence through and hides internals', () => {
    expect(userMessage(http(409))).toBe('This quote has expired — please start a new booking');
    expect(userMessage(http(500, 'stack trace'))).toBe(
      'Something went wrong on our side. Please try again in a moment.',
    );
    expect(
      userMessage(new ApiError({ kind: 'NETWORK', status: 0, code: 'NETWORK', message: 'x' })),
    ).toContain('offline');
    expect(userMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });

  it('never retries a 4xx, retries transient failures twice', () => {
    expect(shouldRetry(0, http(422))).toBe(false);
    expect(shouldRetry(0, http(503))).toBe(true);
    expect(shouldRetry(2, http(503))).toBe(false);
  });
});
