/**
 * Which recurring availability windows (photographer_availability: ISO weekday + local times) a
 * shoot needs. IST is a fixed UTC+05:30, so this is plain arithmetic. A shoot that crosses
 * midnight needs a window on each day; "until end of day" is written 23:59, which is how ops
 * enters it (a `time` column cannot hold 24:00 in the admin form).
 */
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
export const END_OF_DAY = '23:59:00';

export interface AvailabilityNeed {
  /** 1 = Monday … 7 = Sunday. */
  readonly isoDow: number;
  /** HH:MM:SS, inclusive start. */
  readonly from: string;
  /** HH:MM:SS, end (23:59:00 = end of day). */
  readonly to: string;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function clock(msIntoDay: number): string {
  const totalSeconds = Math.floor(msIntoDay / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(totalSeconds % 60)}`;
}

function isoDowOf(localDayStartMs: number): number {
  const day = new Date(localDayStartMs).getUTCDay();
  return day === 0 ? 7 : day;
}

export function availabilityNeeds(start: Date, end: Date): AvailabilityNeed[] {
  const localStart = start.getTime() + IST_OFFSET_MS;
  const localEnd = end.getTime() + IST_OFFSET_MS;
  const needs: AvailabilityNeed[] = [];
  for (let day = Math.floor(localStart / DAY_MS) * DAY_MS; day < localEnd; day += DAY_MS) {
    const from = Math.max(localStart, day) - day;
    const until = Math.min(localEnd, day + DAY_MS) - day;
    needs.push({
      isoDow: isoDowOf(day),
      from: clock(from),
      to: until >= DAY_MS ? END_OF_DAY : clock(until),
    });
  }
  return needs;
}
