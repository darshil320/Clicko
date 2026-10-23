import { describe, expect, it } from 'vitest';
import {
  BOOKING_WINDOW_DAYS,
  clampSlot,
  datePills,
  earliestSlot,
  FIRST_SLOT_MINUTE,
  LAST_SLOT_MINUTE,
  referenceSlot,
  timeSlots,
} from './schedule';

/** An instant given as IST wall-clock time. */
const ist = (wallClock: string): Date => new Date(`${wallClock}+05:30`);

describe('timeSlots', () => {
  it('offers 30-minute starts from 6:00 am to 10:00 pm on a future day', () => {
    const slots = timeSlots('2026-11-14', ist('2026-11-10T09:00:00'));
    expect(slots[0]).toBe(FIRST_SLOT_MINUTE);
    expect(slots.at(-1)).toBe(LAST_SLOT_MINUTE);
    expect(slots).toHaveLength(33);
    expect(slots.every((m, i) => i === 0 || m - (slots[i - 1] as number) === 30)).toBe(true);
  });

  it('starts today at least an hour out, rounded up to the next half hour', () => {
    // 2:10 pm IST → earliest 3:30 pm (3:10 rounded up).
    expect(timeSlots('2026-11-10', ist('2026-11-10T14:10:00'))[0]).toBe(15 * 60 + 30);
    // 2:30 pm exactly → 3:30 pm.
    expect(timeSlots('2026-11-10', ist('2026-11-10T14:30:00'))[0]).toBe(15 * 60 + 30);
  });

  it('uses the IST calendar day, not UTC — 1 am IST is still "today" in India', () => {
    const now = ist('2026-11-10T01:00:00'); // 19:30 UTC on 9 Nov
    expect(timeSlots('2026-11-10', now)[0]).toBe(FIRST_SLOT_MINUTE);
    expect(timeSlots('2026-11-09', now)).toEqual([]);
  });

  it('has nothing left late at night', () => {
    expect(timeSlots('2026-11-10', ist('2026-11-10T21:30:00'))).toEqual([]);
  });
});

describe('datePills', () => {
  it('lists the next 14 days, labelled DD MMM, starting today', () => {
    const pills = datePills(ist('2026-11-10T09:00:00'));
    expect(pills).toHaveLength(BOOKING_WINDOW_DAYS);
    expect(pills[0]).toEqual({
      dateKey: '2026-11-10',
      weekday: 'Today',
      label: '10 Nov',
      isToday: true,
    });
    expect(pills[1]).toMatchObject({ dateKey: '2026-11-11', weekday: 'Wed', label: '11 Nov' });
    expect(pills.at(-1)?.dateKey).toBe('2026-11-23');
  });

  it('starts tomorrow once today has no slot left', () => {
    const pills = datePills(ist('2026-11-10T21:45:00'));
    expect(pills[0]?.dateKey).toBe('2026-11-11');
    expect(pills.some((p) => p.isToday)).toBe(false);
  });

  it('crosses month and year boundaries', () => {
    const pills = datePills(ist('2026-12-25T08:00:00'));
    expect(pills.map((p) => p.label)).toContain('1 Jan');
    expect(pills.at(-1)?.dateKey).toBe('2027-01-07');
  });
});

describe('earliestSlot / referenceSlot', () => {
  it('earliest is the first open start today', () => {
    expect(earliestSlot(ist('2026-11-10T14:10:00'))).toEqual({
      dateKey: '2026-11-10',
      startMinute: 15 * 60 + 30,
    });
  });

  it('reference is a weekday at least 3 days out at 11:00 am', () => {
    // Tue 10 Nov + 3 = Fri 13 Nov.
    expect(referenceSlot(ist('2026-11-10T09:00:00'))).toEqual({
      dateKey: '2026-11-13',
      startMinute: 660,
    });
    // Wed 11 Nov + 3 = Sat 14 → skips to Mon 16.
    expect(referenceSlot(ist('2026-11-11T09:00:00')).dateKey).toBe('2026-11-16');
  });
});

describe('clampSlot', () => {
  it('keeps a slot that is still open', () => {
    const slot = { dateKey: '2026-11-14', startMinute: 990 };
    expect(clampSlot(slot, ist('2026-11-10T09:00:00'))).toEqual(slot);
  });

  it('moves a slot that has passed to the next open start that day', () => {
    expect(
      clampSlot({ dateKey: '2026-11-10', startMinute: 600 }, ist('2026-11-10T14:10:00')),
    ).toEqual({
      dateKey: '2026-11-10',
      startMinute: 15 * 60 + 30,
    });
  });

  it('moves a slot on a past day to the first bookable day', () => {
    expect(
      clampSlot({ dateKey: '2026-11-01', startMinute: 990 }, ist('2026-11-10T09:00:00')),
    ).toEqual({
      dateKey: '2026-11-10',
      startMinute: 990,
    });
  });
});
