import { describe, expect, it } from 'vitest';
import { availabilityNeeds } from '../ist-window';

// 06:30Z = 12:00 IST.
describe('availabilityNeeds (IST weekday + times a shoot occupies)', () => {
  it('a same-day shoot needs one window on its IST weekday', () => {
    // Sunday 15 Nov 2026, 12:00–14:00 IST
    expect(
      availabilityNeeds(new Date('2026-11-15T06:30:00Z'), new Date('2026-11-15T08:30:00Z')),
    ).toEqual([{ isoDow: 7, from: '12:00:00', to: '14:00:00' }]);
  });

  it('uses the IST date, not the UTC date', () => {
    // 20:00Z Monday = 01:30 IST Tuesday
    expect(
      availabilityNeeds(new Date('2026-11-16T20:00:00Z'), new Date('2026-11-16T22:00:00Z')),
    ).toEqual([{ isoDow: 2, from: '01:30:00', to: '03:30:00' }]);
  });

  it('splits a shoot that runs past midnight IST into two windows', () => {
    // Saturday 22:00 IST → Sunday 01:00 IST
    expect(
      availabilityNeeds(new Date('2026-11-14T16:30:00Z'), new Date('2026-11-14T19:30:00Z')),
    ).toEqual([
      { isoDow: 6, from: '22:00:00', to: '23:59:00' },
      { isoDow: 7, from: '00:00:00', to: '01:00:00' },
    ]);
  });

  it('a shoot ending exactly at midnight needs only its own day, to end of day', () => {
    expect(
      availabilityNeeds(new Date('2026-11-14T16:30:00Z'), new Date('2026-11-14T18:30:00Z')),
    ).toEqual([{ isoDow: 6, from: '22:00:00', to: '23:59:00' }]);
  });
});
