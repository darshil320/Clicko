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
  readonly checkedOutAt: Date;
  readonly totalPaise: bigint;
}

export interface EarningBuckets {
  readonly todayPaise: bigint;
  readonly weekPaise: bigint;
  readonly monthPaise: bigint;
  /** Everything not yet paid: all of it until payout batches exist (S8). */
  readonly pendingPaise: bigint;
}

export function bucketEarnings(jobs: readonly EarningInput[], now: Date): EarningBuckets {
  const p = istPeriodStarts(now);
  const sum = (since: Date | null) =>
    jobs
      .filter((j) => since === null || j.checkedOutAt >= since)
      .reduce((total, j) => total + j.totalPaise, 0n);
  return {
    todayPaise: sum(p.day),
    weekPaise: sum(p.week),
    monthPaise: sum(p.month),
    pendingPaise: sum(null),
  };
}
