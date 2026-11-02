/** ADR-0013 D13 — IST period buckets for the Pro earnings dashboard (G-23). Pure. */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface PeriodStarts {
  readonly day: Date;
  /** ISO week: Monday 00:00 IST. */
  readonly week: Date;
  readonly month: Date;
}

/** IST is a fixed UTC+05:30 with no DST: shift, truncate in UTC terms, shift back. */
export function istPeriodStarts(now: Date): PeriodStarts {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  const dayLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const isoWeekday = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
  const weekLocal = dayLocal - (isoWeekday - 1) * DAY_MS;
  const monthLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1);
  return {
    day: new Date(dayLocal - IST_OFFSET_MS),
    week: new Date(weekLocal - IST_OFFSET_MS),
    month: new Date(monthLocal - IST_OFFSET_MS),
  };
}

export interface EarningInput {
  /** The check-out — or, for a shoot that ended without one but still pays, when it ended. */
  readonly endedAt: Date;
  readonly totalPaise: bigint;
  /** Its payout is paid or withheld (ADR-0027 D5): no longer pending. */
  readonly settled?: boolean;
}

export interface EarningBuckets {
  readonly todayPaise: bigint;
  readonly weekPaise: bigint;
  readonly monthPaise: bigint;
  /** Every job whose payout is neither paid nor withheld yet. */
  readonly pendingPaise: bigint;
}

const total = (jobs: readonly EarningInput[]): bigint =>
  jobs.reduce((sum, j) => sum + j.totalPaise, 0n);

export function bucketEarnings(jobs: readonly EarningInput[], now: Date): EarningBuckets {
  const p = istPeriodStarts(now);
  const since = (start: Date) => total(jobs.filter((j) => j.endedAt >= start));
  return {
    todayPaise: since(p.day),
    weekPaise: since(p.week),
    monthPaise: since(p.month),
    pendingPaise: total(jobs.filter((j) => j.settled !== true)),
  };
}
