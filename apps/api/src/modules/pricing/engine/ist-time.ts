/**
 * Asia/Kolkata wall-clock parts for an instant. IST is a fixed UTC+05:30 with no DST,
 * so the conversion is a constant shift — no Intl/timezone database dependency.
 */
const IST_OFFSET_MS = 330 * 60_000;

export interface IstParts {
  /** YYYY-MM-DD, comparable lexicographically with FestivalRule dates. */
  readonly isoDate: string;
  /** Minutes after local midnight, 0–1439. */
  readonly minuteOfDay: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  readonly isoWeekday: number;
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

export function toIst(instant: Date): IstParts {
  const local = new Date(instant.getTime() + IST_OFFSET_MS);
  const isoDate = `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1, 2)}-${pad(local.getUTCDate(), 2)}`;
  const day = local.getUTCDay();
  return {
    isoDate,
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
    isoWeekday: day === 0 ? 7 : day,
  };
}
