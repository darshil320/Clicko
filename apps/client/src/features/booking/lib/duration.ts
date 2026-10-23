/** Booked duration: minimum 2 hours, 30-minute steps (contracts Hours). Capped at 12 in the app. */
export const MIN_HOURS = 2;
export const HOURS_STEP = 0.5;
export const MAX_HOURS = 12;

export function stepHours(hours: number, direction: 1 | -1): number {
  const next = hours + direction * HOURS_STEP;
  return Math.min(MAX_HOURS, Math.max(MIN_HOURS, next));
}

export const canDecrease = (hours: number): boolean => hours > MIN_HOURS;
export const canIncrease = (hours: number): boolean => hours < MAX_HOURS;
