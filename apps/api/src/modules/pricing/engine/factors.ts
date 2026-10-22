/** doc 05 §3 steps 5–8: category uplift, emergency band, festival surge, night and weekend. */
import type { EmergencyBand, PlanTier } from '@clickco/contracts';
import { HOUR_MS, NEUTRAL_BPS } from './constants';
import type { CategoryUpliftRule, FestivalRule, NightRule, WeekendRule } from './types';

/** Upper bounds are exclusive: exactly 3.0 h of lead time is HOURS_3_8, not HOURS_UNDER_3. */
const BAND_UPPER_BOUNDS: ReadonlyArray<readonly [number, EmergencyBand]> = [
  [3 * HOUR_MS, 'HOURS_UNDER_3'],
  [8 * HOUR_MS, 'HOURS_3_8'],
  [24 * HOUR_MS, 'SAME_DAY'],
  [48 * HOUR_MS, 'NEXT_DAY'],
];

export function resolveEmergencyBand(scheduledStart: Date, now: Date): EmergencyBand {
  const leadMs = scheduledStart.getTime() - now.getTime();
  if (!Number.isFinite(leadMs)) {
    throw new RangeError('resolveEmergencyBand: scheduledStart and now must be valid dates');
  }
  const band = BAND_UPPER_BOUNDS.find(([upperMs]) => leadMs < upperMs);
  return band ? band[1] : 'NONE';
}

/** Tier-specific row wins over the tier-agnostic row; undefined = category not priced. */
export function resolveUpliftBps(
  rules: readonly CategoryUpliftRule[],
  categoryCode: string,
  tier: PlanTier,
): number | undefined {
  const forCategory = rules.filter((r) => r.categoryCode === categoryCode);
  const rule = forCategory.find((r) => r.tier === tier) ?? forCategory.find((r) => r.tier === null);
  return rule?.multiplierBps;
}

export interface Surge {
  readonly surgeBps: number;
  /** Label of the festival that set surgeBps; null when none applies. */
  readonly label: string | null;
  readonly isPeakSeason: boolean;
}

/** Overlapping festivals take the MAX multiplier, never the product. Dates inclusive both ends. */
export function resolveSurge(
  festivals: readonly FestivalRule[],
  istDate: string,
  cityId: string,
): Surge {
  const active = festivals.filter(
    (f) =>
      f.dateFrom <= istDate && istDate <= f.dateTo && (f.cityId === null || f.cityId === cityId),
  );
  const top = active.reduce<FestivalRule | null>(
    (best, f) => (best === null || f.multiplierBps > best.multiplierBps ? f : best),
    null,
  );
  return {
    surgeBps: top?.multiplierBps ?? NEUTRAL_BPS,
    label: top?.label ?? null,
    isPeakSeason: active.some((f) => f.isPeakSeason),
  };
}

/** Judged on the start time only. A window with start > end wraps midnight. */
export function resolveNightBps(rule: NightRule | null, minuteOfDay: number): number {
  if (rule === null) return NEUTRAL_BPS;
  const { windowStartMinute: start, windowEndMinute: end } = rule;
  const isNight =
    start > end
      ? minuteOfDay >= start || minuteOfDay < end
      : start <= minuteOfDay && minuteOfDay < end;
  return isNight ? rule.multiplierBps : NEUTRAL_BPS;
}

export function resolveWeekendBps(rule: WeekendRule | null, isoWeekday: number): number {
  return rule?.isoDays.includes(isoWeekday) ? rule.multiplierBps : NEUTRAL_BPS;
}
