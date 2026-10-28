import type { EarningsJob } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { dayLabel, extrasLine, groupByDay, jobSubtitle, jobTitle } from './earnings';

/** 28 Oct 2026, 3:30 pm IST (a Wednesday). */
const NOW = new Date('2026-10-28T10:00:00.000Z');

let seq = 0;
function job(overrides: Partial<EarningsJob> = {}): EarningsJob {
  seq += 1;
  return {
    assignmentId: `5b0e7c1a-9d2f-4e3b-8a6c-${String(seq).padStart(12, '0')}`,
    bookingId: `8e3f1a2b-4c5d-4e6f-9a0b-${String(seq).padStart(12, '0')}`,
    bookingReference: `CK-2026-${String(seq).padStart(5, '0')}`,
    categoryCode: 'FOOD',
    scheduledStart: '2026-10-28T12:30:00+05:30',
    checkedOutAt: '2026-10-28T14:45:00+05:30',
    basePayoutPaise: 420_000,
    extrasPayoutPaise: 0,
    totalPayoutPaise: 420_000,
    ...overrides,
  };
}

describe('dayLabel', () => {
  it.each([
    ['2026-10-28', 'Today'],
    ['2026-10-27', 'Yesterday'],
    ['2026-10-26', 'Mon, 26 Oct'],
    ['2026-09-14', 'Mon, 14 Sep'],
  ])('%s → %s', (key, expected) => {
    expect(dayLabel(key, '2026-10-28')).toBe(expected);
  });
});

describe('groupByDay', () => {
  it('groups by the IST day of check-out, newest first, with a total per day', () => {
    const lateToday = job({ checkedOutAt: '2026-10-28T19:10:00+05:30', totalPayoutPaise: 510_000 });
    const earlyToday = job({
      checkedOutAt: '2026-10-28T11:00:00+05:30',
      totalPayoutPaise: 420_050,
    });
    const yesterday = job({ checkedOutAt: '2026-10-27T18:00:00+05:30', totalPayoutPaise: 300_000 });
    const days = groupByDay([yesterday, earlyToday, lateToday], NOW);

    expect(days.map((d) => d.label)).toEqual(['Today', 'Yesterday']);
    expect(days[0]?.jobs.map((j) => j.assignmentId)).toEqual([
      lateToday.assignmentId,
      earlyToday.assignmentId,
    ]);
    expect(days[0]?.totalPaise).toBe(930_050n);
    expect(days[1]?.totalPaise).toBe(300_000n);
  });

  it('uses the IST calendar: 00:30 IST is the next day though it is still the evening in UTC', () => {
    const afterMidnightIst = job({ checkedOutAt: '2026-10-27T19:00:00.000Z' }); // 28 Oct 00:30 IST
    const beforeMidnightIst = job({ checkedOutAt: '2026-10-27T18:20:00.000Z' }); // 27 Oct 23:50 IST
    const days = groupByDay([afterMidnightIst, beforeMidnightIst], NOW);
    expect(days.map((d) => d.key)).toEqual(['2026-10-28', '2026-10-27']);
  });

  it('is empty for no jobs, and leaves its input alone', () => {
    expect(groupByDay([], NOW)).toEqual([]);
    const input = [
      job({ checkedOutAt: '2026-10-20T10:00:00+05:30' }),
      job({ checkedOutAt: '2026-10-25T10:00:00+05:30' }),
    ];
    const before = input.map((j) => j.assignmentId);
    groupByDay(input, NOW);
    expect(input.map((j) => j.assignmentId)).toEqual(before);
  });
});

describe('extrasLine', () => {
  it('splits the shoot payout from the extension and waiting share', () => {
    const withExtras = job({
      basePayoutPaise: 420_000,
      extrasPayoutPaise: 60_000,
      totalPayoutPaise: 480_000,
    });
    expect(extrasLine(withExtras)).toBe('₹4,200 shoot + ₹600 extension & waiting');
  });

  it('shows paise only when there are some', () => {
    const odd = job({ basePayoutPaise: 420_000, extrasPayoutPaise: 48_750 });
    expect(extrasLine(odd)).toBe('₹4,200 shoot + ₹487.50 extension & waiting');
  });

  it('is nothing when there were no extras', () => {
    expect(extrasLine(job())).toBeNull();
  });
});

describe('job row copy', () => {
  it('titles the job by category', () => {
    expect(jobTitle(job({ categoryCode: 'REAL_ESTATE' }))).toBe('Real Estate shoot');
  });

  it('gives the reference and the check-out time, then any extras on a second line', () => {
    const plain = job({ bookingReference: 'CK-2026-00412' });
    expect(jobSubtitle(plain)).toBe('CK-2026-00412 · Checked out 2:45 pm');
    const extra = job({
      bookingReference: 'CK-2026-00413',
      checkedOutAt: '2026-10-28T19:05:00+05:30',
      extrasPayoutPaise: 60_000,
    });
    expect(jobSubtitle(extra)).toBe(
      'CK-2026-00413 · Checked out 7:05 pm\n₹4,200 shoot + ₹600 extension & waiting',
    );
  });
});
