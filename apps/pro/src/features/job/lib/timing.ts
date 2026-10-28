import { UPLOAD_WITHIN_HOURS } from '@/shared/catalogue';
import { formatDateTime, formatTime, istDateKey, istParts } from '@/shared/format/datetime';

/**
 * On-site timing, mirroring the server's rules (ADR-0013) so the screen can gate buttons and
 * count down while offline. The server stays authoritative: it re-checks every one of these.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** ADR-0013 D2: en-route and check-in open this long before the scheduled start. */
export const OPENS_BEFORE_START_MINUTES = 180;
/** ADR-0013 D8: extensions are one-hour blocks. */
export const EXTENSION_BLOCK_MINUTES = 60;
/** ADR-0013 D12 / T&C §3.8: the client may be reported absent this long after the billing start. */
export const CLIENT_ABSENT_AFTER_MINUTES = 60;
/** ADR-0013 D3: the venue fence — for helper copy only; the 150 m decision is the server's. */
export const GEOFENCE_RADIUS_M = 150;

const ms = (iso: string): number => Date.parse(iso);
const iso = (instant: number): string => new Date(instant).toISOString();

/** Scheduled start − 3 h. Before this the API answers 409 TOO_EARLY. */
export function opensAt(scheduledStart: string): string {
  return iso(ms(scheduledStart) - OPENS_BEFORE_START_MINUTES * MINUTE_MS);
}

/** max(check-in, scheduled start): early arrival never shortens the shoot (ADR-0013 D6). */
export function billingStartsAt(checkInAt: string, scheduledStart: string): string {
  return iso(Math.max(ms(checkInAt), ms(scheduledStart)));
}

/** Billing start + booked hours + approved extension hours. Logged waiting does not extend it. */
export function earliestCheckOutAt(
  billingStart: string,
  scheduledHours: number,
  approvedExtensionHours: number,
): string {
  const minutes =
    Math.round(scheduledHours * 60) + approvedExtensionHours * EXTENSION_BLOCK_MINUTES;
  return iso(ms(billingStart) + minutes * MINUTE_MS);
}

export function clientAbsentOpensAt(billingStart: string): string {
  return iso(ms(billingStart) + CLIENT_ABSENT_AFTER_MINUTES * MINUTE_MS);
}

/** Check-out + the upload window (ADR-0014). */
export function uploadDeadlineAt(checkedOutAt: string): string {
  return iso(ms(checkedOutAt) + UPLOAD_WITHIN_HOURS * HOUR_MS);
}

/** "1h 47m", "47m", "0m" — whole minutes, never negative. */
export function formatElapsed(durationMs: number): string {
  const minutes = Math.max(0, Math.floor(durationMs / MINUTE_MS));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** "23:04" under an hour, "1h 05m" from an hour up, "0:00" once due. */
export function formatCountdown(durationMs: number): string {
  if (durationMs <= 0) return '0:00';
  const seconds = Math.ceil(durationMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${pad2(minutes)}m`;
  return `${minutes}:${pad2(seconds % 60)}`;
}

/** "4:30 pm" on the same IST day as `now`, otherwise "15 Nov, 9:30 am". */
export function formatAt(instantIso: string, now: Date): string {
  const instant = new Date(instantIso);
  if (istDateKey(instant) !== istDateKey(now)) return formatDateTime(instantIso);
  return formatTime(istParts(instant).minuteOfDay);
}

/** "4:30 pm" — for on-site moments, which all fall within the shoot day. */
export function formatClock(instantIso: string): string {
  return formatTime(istParts(new Date(instantIso)).minuteOfDay);
}
