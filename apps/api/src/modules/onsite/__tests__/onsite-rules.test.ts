import { describe, expect, it } from 'vitest';
import { bucketEarnings, istPeriodStarts } from '../rules/earnings';
import { type ExtensionEventInput, extensionLedger } from '../rules/extensions';
import { decideGeofence } from '../rules/geofence';
import { isLateReplacement, noShowFirstCheckAt, noShowStep } from '../rules/no-show';
import {
  authoritativeTime,
  billingStartsAt,
  clientAbsentOpensAt,
  deliveryDueAt,
  earliestCheckOutAt,
  onsiteOpensAt,
  waitingElapsedMinutes,
} from '../rules/timing';

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = new Date('2026-11-15T06:30:00.000Z'); // Sunday 12:00 IST
const at = (minutesFromStart: number) => new Date(START.getTime() + minutesFromStart * MIN);

describe('decideGeofence (ADR-0013 D3)', () => {
  it('accepts within 150 m of a geocoded venue, refuses beyond it', () => {
    expect(decideGeofence({ distanceM: 150, accuracyM: 20, basis: 'VENUE' })).toEqual({
      kind: 'ACCEPTED',
      verified: true,
    });
    expect(decideGeofence({ distanceM: 150.1, accuracyM: 20, basis: 'VENUE' })).toEqual({
      kind: 'OUTSIDE_GEOFENCE',
      limitM: 150,
    });
  });

  it('refuses a fix less accurate than 100 m whatever the distance', () => {
    expect(decideGeofence({ distanceM: 5, accuracyM: 100.5, basis: 'VENUE' })).toEqual({
      kind: 'LOCATION_TOO_INACCURATE',
      maxAccuracyM: 100,
    });
    expect(decideGeofence({ distanceM: 5, accuracyM: 100, basis: 'VENUE' }).kind).toBe('ACCEPTED');
  });

  it('on a fallback point: verified within 150 m, unverified up to its limit, refused beyond', () => {
    expect(decideGeofence({ distanceM: 120, accuracyM: 10, basis: 'CITY_CENTRE' })).toEqual({
      kind: 'ACCEPTED',
      verified: true,
    });
    expect(decideGeofence({ distanceM: 2_999, accuracyM: 10, basis: 'PINCODE_CENTROID' })).toEqual({
      kind: 'ACCEPTED',
      verified: false,
    });
    expect(decideGeofence({ distanceM: 3_001, accuracyM: 10, basis: 'PINCODE_CENTROID' })).toEqual({
      kind: 'OUTSIDE_GEOFENCE',
      limitM: 3_000,
    });
    expect(decideGeofence({ distanceM: 29_000, accuracyM: 10, basis: 'CITY_CENTRE' }).kind).toBe(
      'ACCEPTED',
    );
    expect(decideGeofence({ distanceM: 30_001, accuracyM: 10, basis: 'CITY_CENTRE' }).kind).toBe(
      'OUTSIDE_GEOFENCE',
    );
  });
});

describe('authoritativeTime (ADR-0013 D5: offline queue, local timestamp)', () => {
  const windowStart = at(-90);
  const serverNow = at(30);

  it('uses the server receive time when online, even with a device time', () => {
    expect(authoritativeTime({ serverNow, deviceTs: at(5), offline: false, windowStart })).toEqual({
      at: serverNow,
      usedDeviceTime: false,
    });
  });

  it('uses an offline device time inside the window and at most 6 h old', () => {
    expect(authoritativeTime({ serverNow, deviceTs: at(5), offline: true, windowStart })).toEqual({
      at: at(5),
      usedDeviceTime: true,
    });
  });

  it('falls back to server time when the device time is before the window or too old', () => {
    expect(
      authoritativeTime({ serverNow, deviceTs: at(-91), offline: true, windowStart }).at,
    ).toEqual(serverNow);
    const late = at(30 + 6 * 60 + 1);
    expect(
      authoritativeTime({ serverNow: late, deviceTs: at(30), offline: true, windowStart }).at,
    ).toEqual(late);
  });

  it('clamps a device clock up to 2 minutes ahead to now; further ahead is ignored', () => {
    expect(authoritativeTime({ serverNow, deviceTs: at(31), offline: true, windowStart })).toEqual({
      at: serverNow,
      usedDeviceTime: true,
    });
    expect(authoritativeTime({ serverNow, deviceTs: at(33), offline: true, windowStart })).toEqual({
      at: serverNow,
      usedDeviceTime: false,
    });
  });

  it('never goes back to or before `after` (a check-out must follow its check-in)', () => {
    const after = at(10);
    expect(
      authoritativeTime({ serverNow, deviceTs: at(10), offline: true, windowStart, after }),
    ).toEqual({ at: serverNow, usedDeviceTime: false });
    expect(
      authoritativeTime({ serverNow, deviceTs: at(11), offline: true, windowStart, after }).at,
    ).toEqual(at(11));
  });

  it('uses the server time without a device time', () => {
    expect(authoritativeTime({ serverNow, offline: true, windowStart }).at).toEqual(serverNow);
  });
});

describe('billing clock and minimum duration (ADR-0013 D6)', () => {
  it('starts at the scheduled start for an early photographer, at check-in for a late one', () => {
    expect(billingStartsAt(at(-25), START)).toEqual(START);
    expect(billingStartsAt(at(12), START)).toEqual(at(12));
  });

  it('needs booked hours plus approved extensions from the billing start', () => {
    expect(earliestCheckOutAt(START, 2, 0)).toEqual(at(120));
    expect(earliestCheckOutAt(at(12), 2.5, 2)).toEqual(at(12 + 150 + 120));
  });

  it('adds charged waiting on top of the booked block (never billed twice)', () => {
    expect(earliestCheckOutAt(START, 2, 1, 25)).toEqual(at(120 + 60 + 25));
  });

  it('opens en-route and check-in 3 h before the start', () => {
    expect(onsiteOpensAt(START)).toEqual(at(-180));
  });

  it('allows client non-attendance 60 min after the start', () => {
    expect(clientAbsentOpensAt(START)).toEqual(at(60));
  });

  it('counts whole elapsed waiting minutes from the billing start, never negative', () => {
    expect(waitingElapsedMinutes(START, at(40.9))).toBe(40);
    expect(waitingElapsedMinutes(START, at(-5))).toBe(0);
  });

  it('stops counting waiting when the shoot started: shooting time is never waiting', () => {
    expect(waitingElapsedMinutes(START, at(90), at(15))).toBe(15);
    expect(waitingElapsedMinutes(START, at(30), null)).toBe(30);
  });

  it('sets delivery due 48 h after SLA T0, 24 h with rush delivery', () => {
    const t0 = at(130);
    expect(deliveryDueAt(t0, false)).toEqual(new Date(t0.getTime() + 48 * HOUR));
    expect(deliveryDueAt(t0, true)).toEqual(new Date(t0.getTime() + 24 * HOUR));
  });
});

describe('no-show ladder (v0.2 §9, ADR-0013 D11)', () => {
  it('checks at start + 15 min; a replacement gets 90 min of travel from acceptance', () => {
    expect(
      noShowFirstCheckAt({ scheduledStart: START, acceptedAt: at(-600), isReplacement: false }),
    ).toEqual(at(15));
    expect(
      noShowFirstCheckAt({ scheduledStart: START, acceptedAt: at(-600), isReplacement: true }),
    ).toEqual(at(15));
    expect(
      noShowFirstCheckAt({ scheduledStart: START, acceptedAt: at(25), isReplacement: true }),
    ).toEqual(at(115));
  });

  const base = { scheduledStart: START, firstCheckAt: at(15), checkedIn: false, active: true };

  it('waits before the first check, alerts at it, escalates 5 min after the alert', () => {
    expect(noShowStep({ ...base, now: at(14), alertedAt: null })).toEqual({
      kind: 'WAIT',
      until: at(15),
    });
    expect(noShowStep({ ...base, now: at(15), alertedAt: null })).toEqual({
      kind: 'ALERT',
      escalateAt: at(20),
    });
    expect(noShowStep({ ...base, now: at(19), alertedAt: at(15) })).toEqual({
      kind: 'WAIT',
      until: at(20),
    });
    expect(noShowStep({ ...base, now: at(20), alertedAt: at(15) })).toEqual({ kind: 'ESCALATE' });
  });

  it('keeps the 5-minute warning when the alert itself was late', () => {
    expect(noShowStep({ ...base, now: at(31), alertedAt: null })).toEqual({
      kind: 'ALERT',
      escalateAt: at(36),
    });
  });

  it('does nothing once checked in or once the assignment has ended', () => {
    expect(noShowStep({ ...base, now: at(40), alertedAt: at(15), checkedIn: true }).kind).toBe(
      'NONE',
    );
    expect(noShowStep({ ...base, now: at(40), alertedAt: null, active: false }).kind).toBe('NONE');
  });

  it('a replacement checking in after start + 15 min is late (T&C §3.6b); originals never', () => {
    expect(
      isLateReplacement({ isReplacement: true, checkInAt: at(16), scheduledStart: START }),
    ).toBe(16);
    expect(
      isLateReplacement({ isReplacement: true, checkInAt: at(15), scheduledStart: START }),
    ).toBeNull();
    expect(
      isLateReplacement({ isReplacement: false, checkInAt: at(40), scheduledStart: START }),
    ).toBeNull();
  });
});

describe('extensionLedger (pairing requests with their resolutions, ADR-0013 D8)', () => {
  const ev = (
    id: string,
    kind: ExtensionEventInput['kind'],
    minute: number,
    note: string | null = null,
  ): ExtensionEventInput => ({ id, kind, occurredAt: at(minute), note, amountPaise: 576_725n });

  it('marks approved, declined and expired requests; the last open one is pending', () => {
    const ledger = extensionLedger(
      [
        ev('1', 'EXTENSION_REQUESTED', 100),
        ev('2', 'EXTENSION_APPROVED', 103),
        ev('3', 'EXTENSION_REQUESTED', 150),
        ev('4', 'EXTENSION_DECLINED', 162, 'EXPIRED'),
        ev('5', 'EXTENSION_REQUESTED', 170),
        ev('6', 'EXTENSION_DECLINED', 171, 'DECLINED_BY_CLIENT'),
        ev('7', 'EXTENSION_REQUESTED', 175),
      ],
      at(180),
    );
    expect(ledger.requests.map((r) => [r.eventId, r.status])).toEqual([
      ['1', 'APPROVED'],
      ['3', 'EXPIRED'],
      ['5', 'DECLINED'],
      ['7', 'PENDING'],
    ]);
    expect(ledger.approvedCount).toBe(1);
    expect(ledger.open?.eventId).toBe('7');
    expect(ledger.open?.expiresAt).toEqual(at(185));
  });

  it('an unresolved request past its 10 minutes is expired (lazily), not pending', () => {
    const ledger = extensionLedger([ev('1', 'EXTENSION_REQUESTED', 100)], at(110));
    expect(ledger.requests[0]?.status).toBe('EXPIRED');
    expect(ledger.open).toBeNull();
    expect(ledger.unresolved?.eventId).toBe('1');
  });

  it('ignores other event kinds', () => {
    const ledger = extensionLedger(
      [{ id: '1', kind: 'WAITING_LOGGED', occurredAt: at(5), note: 'x', amountPaise: 0n }],
      at(10),
    );
    expect(ledger.requests).toEqual([]);
  });
});

describe('earnings buckets (IST, ADR-0013 D13)', () => {
  // 2026-11-18 is a Wednesday. 23:00 IST = 17:30 UTC.
  const now = new Date('2026-11-18T17:30:00.000Z');

  it('starts the IST day, ISO week (Monday) and month at local midnight', () => {
    expect(istPeriodStarts(now)).toEqual({
      day: new Date('2026-11-17T18:30:00.000Z'),
      week: new Date('2026-11-15T18:30:00.000Z'),
      month: new Date('2026-10-31T18:30:00.000Z'),
    });
  });

  it('sums each bucket; pending counts everything (no payouts before S8)', () => {
    const jobs = [
      { checkedOutAt: new Date('2026-11-18T05:00:00.000Z'), totalPaise: 100n }, // today
      { checkedOutAt: new Date('2026-11-16T05:00:00.000Z'), totalPaise: 20n }, // Monday
      { checkedOutAt: new Date('2026-11-15T17:00:00.000Z'), totalPaise: 3n }, // Sunday 22:30 IST
      { checkedOutAt: new Date('2026-10-31T19:00:00.000Z'), totalPaise: 4000n }, // 1 Nov IST
      { checkedOutAt: new Date('2026-10-30T05:00:00.000Z'), totalPaise: 50_000n }, // October
    ];
    expect(bucketEarnings(jobs, now)).toEqual({
      todayPaise: 100n,
      weekPaise: 120n,
      monthPaise: 4123n,
      pendingPaise: 54_123n,
    });
  });
});
