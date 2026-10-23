/**
 * bookings.scheduled_hours is numeric(4,1) in 0.5 steps (never money): '2.5' → 2.5.
 * Validated rather than trusted, so a malformed value fails loudly.
 */
export function hoursFromNumeric(text: string): number {
  const hours = Number(text);
  if (!Number.isFinite(hours) || !Number.isInteger(hours * 2)) {
    throw new RangeError(`hoursFromNumeric: ${text} is not a half-hour count`);
  }
  return hours;
}
