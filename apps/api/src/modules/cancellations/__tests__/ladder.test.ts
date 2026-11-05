import type { BookingStatus, EmergencyBand } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { bandReason, cancellationBlock, ladderStep, splitRefund } from '../rules/ladder';

const HOUR = 3_600_000;
const START = new Date('2027-03-10T04:30:00.000Z');
const before = (hours: number) => new Date(START.getTime() - hours * HOUR);

const step = (
  hoursBefore: number,
  o: { status?: BookingStatus; band?: EmergencyBand; peak?: boolean } = {},
) =>
  ladderStep({
    status: o.status ?? 'DISPATCHING',
    emergencyBand: o.band ?? 'NONE',
    scheduledStart: START,
    now: before(hoursBefore),
    peakSeason: o.peak ?? false,
  });

describe('T&C §3.1 — standard bookings, by the notice given', () => {
  it.each([
    [240, 'MORE_THAN_7_DAYS', 10_000],
    [168, 'MORE_THAN_7_DAYS', 10_000], // exactly 7 days is not "less than 7 days"
    [167.99, 'DAYS_3_TO_7', 10_000],
    [72, 'DAYS_3_TO_7', 10_000], // exactly 72 h: the better band (client's favour)
    [71.99, 'HOURS_24_TO_72', 5_000],
    [24, 'HOURS_24_TO_72', 5_000], // exactly 24 h: still 50 %
    [23.99, 'UNDER_24_HOURS', 0],
    [0.5, 'UNDER_24_HOURS', 0],
  ] as const)('%s h before → %s (%s bps)', (hours, band, bps) => {
    expect(step(hours)).toMatchObject({ band, refundBps: bps, clause: '3.1' });
  });

  it('applies whether or not a photographer has accepted (NONE and NEXT_DAY are standard)', () => {
    expect(step(48, { status: 'ASSIGNED' })).toMatchObject({ band: 'HOURS_24_TO_72' });
    expect(step(30, { status: 'EN_ROUTE', band: 'NEXT_DAY' })).toMatchObject({
      band: 'HOURS_24_TO_72',
      refundBps: 5_000,
    });
    expect(step(200, { status: 'CONFIRMED' })).toMatchObject({ band: 'MORE_THAN_7_DAYS' });
  });

  it('says when the refund next gets smaller', () => {
    expect(step(240).changesAt).toEqual(before(72));
    expect(step(100).changesAt).toEqual(before(72));
    expect(step(48).changesAt).toEqual(before(24));
    expect(step(10).changesAt).toBeNull();
  });
});

describe('T&C §3.2 — peak season: 50 % of the advance forfeited inside 7 days', () => {
  it('under 7 days before a peak-season shoot: a flat half of the advance, whatever the notice', () => {
    for (const hours of [167.99, 100, 72, 48, 24, 12, 0.5]) {
      expect(step(hours, { peak: true })).toMatchObject({
        band: 'PEAK_SEASON_UNDER_7_DAYS',
        refundBps: 5_000,
        clause: '3.2',
        changesAt: null, // it no longer changes before the shoot
      });
    }
  });

  it('7 days or more before: the full advance, and the drop at 7 days is announced', () => {
    expect(step(168, { peak: true })).toMatchObject({
      band: 'MORE_THAN_7_DAYS',
      refundBps: 10_000,
    });
    expect(step(200, { peak: true }).changesAt).toEqual(before(168));
  });
});

describe('T&C §3.3 — emergency and same-day bookings', () => {
  it.each(['SAME_DAY', 'HOURS_3_8', 'HOURS_UNDER_3'] as const)(
    '%s: free before a photographer accepts, nothing after',
    (band) => {
      for (const status of ['CONFIRMED', 'DISPATCHING'] as const) {
        expect(step(5, { band, status })).toMatchObject({
          band: 'EMERGENCY_BEFORE_ACCEPTANCE',
          refundBps: 10_000,
          clause: '3.3',
          changesAt: null,
        });
      }
      for (const status of ['ASSIGNED', 'EN_ROUTE'] as const) {
        expect(step(5, { band, status })).toMatchObject({
          band: 'EMERGENCY_AFTER_ACCEPTANCE',
          refundBps: 0,
          clause: '3.3',
        });
      }
    },
  );

  it('peak season does not override the emergency carve-out', () => {
    expect(step(5, { band: 'SAME_DAY', peak: true })).toMatchObject({
      band: 'EMERGENCY_BEFORE_ACCEPTANCE',
      refundBps: 10_000,
    });
  });
});

describe('ladderStep guards', () => {
  it('refuses a status the ladder does not cover', () => {
    expect(() => step(48, { status: 'QUOTED' })).toThrow(RangeError);
    expect(() => step(48, { status: 'CHECKED_IN' })).toThrow(RangeError);
  });

  it('refuses invalid dates', () => {
    expect(() =>
      ladderStep({
        status: 'DISPATCHING',
        emergencyBand: 'NONE',
        scheduledStart: new Date(Number.NaN),
        now: START,
        peakSeason: false,
      }),
    ).toThrow(RangeError);
  });
});

describe('splitRefund — the ladder applies to the advance, in bigint paise', () => {
  it('100 %: everything paid comes back', () => {
    expect(splitRefund({ advancePaise: 501_500n, refundBps: 10_000, paidPaise: 501_500n })).toEqual(
      { refundPaise: 501_500n, keptPaise: 0n },
    );
  });

  it('50 % of an odd advance rounds half-up in the client’s favour', () => {
    expect(splitRefund({ advancePaise: 501_501n, refundBps: 5_000, paidPaise: 501_501n })).toEqual({
      refundPaise: 250_751n,
      keptPaise: 250_750n,
    });
  });

  it('nothing: the whole advance is kept', () => {
    expect(splitRefund({ advancePaise: 501_500n, refundBps: 0, paidPaise: 501_500n })).toEqual({
      refundPaise: 0n,
      keptPaise: 501_500n,
    });
  });

  it('only the advance is forfeited: money paid beyond it comes back in full', () => {
    expect(
      splitRefund({ advancePaise: 500_000n, refundBps: 5_000, paidPaise: 1_000_000n }),
    ).toEqual({ refundPaise: 750_000n, keptPaise: 250_000n });
  });

  it('a refund already made counts toward what comes back (never more than the ladder)', () => {
    // ₹1,000 went back earlier; 50 % of a ₹5,000 advance: ₹1,500 more, Clickco keeps ₹2,500.
    expect(splitRefund({ advancePaise: 500_000n, refundBps: 5_000, paidPaise: 400_000n })).toEqual({
      refundPaise: 150_000n,
      keptPaise: 250_000n,
    });
    expect(splitRefund({ advancePaise: 500_000n, refundBps: 5_000, paidPaise: 100_000n })).toEqual({
      refundPaise: 0n,
      keptPaise: 100_000n,
    });
  });

  it('nothing captured (a hold that was never charged): nothing either way', () => {
    expect(splitRefund({ advancePaise: 500_000n, refundBps: 10_000, paidPaise: 0n })).toEqual({
      refundPaise: 0n,
      keptPaise: 0n,
    });
  });

  it('refuses negative amounts and basis points outside 0–10000', () => {
    expect(() => splitRefund({ advancePaise: -1n, refundBps: 0, paidPaise: 0n })).toThrow(
      RangeError,
    );
    expect(() => splitRefund({ advancePaise: 1n, refundBps: 10_001, paidPaise: 0n })).toThrow(
      RangeError,
    );
    expect(() => splitRefund({ advancePaise: 1n, refundBps: 0, paidPaise: -1n })).toThrow(
      RangeError,
    );
  });
});

describe('bandReason — plain words, no amounts', () => {
  it('names the notice band and what happens to the advance', () => {
    expect(bandReason('HOURS_24_TO_72')).toMatch(/24 to 72 hours.*half of your advance/);
    expect(bandReason('UNDER_24_HOURS')).toMatch(/less than 24 hours.*no refund/);
    expect(bandReason('PEAK_SEASON_UNDER_7_DAYS')).toMatch(/peak season/);
    expect(bandReason('EMERGENCY_BEFORE_ACCEPTANCE')).toMatch(/free of charge/);
    expect(bandReason('BEFORE_PAYMENT')).toMatch(/nothing to refund/);
    expect(bandReason('MORE_THAN_7_DAYS')).not.toMatch(/₹/);
  });
});

describe('cancellationBlock — when the app cannot cancel (DOMAIN §2)', () => {
  const at = (status: BookingStatus, hoursBefore = 48) =>
    cancellationBlock(status, START, before(hoursBefore));

  it('every paid pre-shoot state is open before the start time', () => {
    for (const s of ['CONFIRMED', 'DISPATCHING', 'ASSIGNED', 'EN_ROUTE'] as const) {
      expect(at(s)).toBeNull();
    }
  });

  it('the unpaid states are left to the pre-payment path', () => {
    expect(at('QUOTED')).toBeNull();
    expect(at('ADVANCE_PENDING')).toBeNull();
  });

  it('once the start time has passed, a pre-shoot booking goes to support (no-show process)', () => {
    expect(at('EN_ROUTE', 0)).toBe('SHOOT_TIME_PASSED');
    expect(at('DISPATCHING', -1)).toBe('SHOOT_TIME_PASSED');
  });

  it('a cancelled booking, a started shoot and a draft are refused', () => {
    expect(at('CANCELLED_CLIENT')).toBe('ALREADY_CANCELLED');
    expect(at('CANCELLED_PRO')).toBe('ALREADY_CANCELLED');
    expect(at('PRO_NO_SHOW')).toBe('ALREADY_CANCELLED');
    for (const s of ['CHECKED_IN', 'IN_PROGRESS', 'CHECKED_OUT', 'DELIVERED', 'CLOSED'] as const) {
      expect(at(s)).toBe('SHOOT_STARTED');
    }
    expect(at('DRAFT')).toBe('NOT_CANCELLABLE');
  });
});
