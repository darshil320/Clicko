import type { EarningsJob } from '@clickco/contracts';
import { toPaiseBigint } from '@clickco/utils';
import { categoryLabel } from '@/shared/catalogue';
import {
  addDays,
  formatDayMonth,
  formatTime,
  formatWeekday,
  istDateKey,
  istParts,
} from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

/** One day of completed shoots, by the IST date of check-out (the API buckets on it too). */
export interface EarningsDay {
  /** "2026-10-28" */
  readonly key: string;
  /** "Today", "Yesterday", "Mon, 26 Oct" */
  readonly label: string;
  readonly totalPaise: bigint;
  readonly jobs: readonly EarningsJob[];
}

/** "Today", "Yesterday", else "Mon, 26 Oct" (DESIGN.md: DD MMM). */
export function dayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return 'Today';
  if (dateKey === addDays(todayKey, -1)) return 'Yesterday';
  return `${formatWeekday(dateKey)}, ${formatDayMonth(dateKey)}`;
}

const checkedOutMs = (job: EarningsJob): number => Date.parse(job.checkedOutAt);

/** Newest day first, newest job first within a day. Totals are summed as bigint paise. */
export function groupByDay(jobs: readonly EarningsJob[], now: Date): readonly EarningsDay[] {
  const todayKey = istDateKey(now);
  const keyed = [...jobs]
    .sort((a, b) => checkedOutMs(b) - checkedOutMs(a))
    .map((job) => ({ job, key: istDateKey(new Date(job.checkedOutAt)) }));
  const dayKeys = [...new Set(keyed.map((entry) => entry.key))];
  return dayKeys.map((key) => {
    const dayJobs = keyed.filter((entry) => entry.key === key).map((entry) => entry.job);
    return {
      key,
      label: dayLabel(key, todayKey),
      totalPaise: dayJobs.reduce((sum, job) => sum + toPaiseBigint(job.totalPayoutPaise), 0n),
      jobs: dayJobs,
    };
  });
}

/** "Food shoot" */
export function jobTitle(job: EarningsJob): string {
  return `${categoryLabel(job.categoryCode)} shoot`;
}

/** "₹4,200 shoot + ₹600 extension & waiting", or null when the shoot earned no extras. */
export function extrasLine(job: EarningsJob): string | null {
  if (job.extrasPayoutPaise <= 0) return null;
  return `${rupees(job.basePayoutPaise)} shoot + ${rupees(job.extrasPayoutPaise)} extension & waiting`;
}

/** "CK-2026-00412 · Checked out 2:45 pm", with the extras on a second line when there are any. */
export function jobSubtitle(job: EarningsJob): string {
  const checkedOut = formatTime(istParts(new Date(job.checkedOutAt)).minuteOfDay);
  const first = `${job.bookingReference} · Checked out ${checkedOut}`;
  const extras = extrasLine(job);
  return extras ? `${first}\n${extras}` : first;
}
