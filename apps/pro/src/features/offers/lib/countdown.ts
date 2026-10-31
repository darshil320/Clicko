/** Offer windows are short (doc 01 screen 11: "Accept in 1:24"). Pure; `now` comes from useNow. */

const SECOND_MS = 1000;
const MINUTE_S = 60;
const HOUR_S = 3600;

/** The last stretch of a live offer, shown in the warning tone. */
export const URGENT_SECONDS = 30;

/**
 * Whole seconds until `expiresAt`, rounded up so that 0 always means the offer has closed.
 * Never negative; an unreadable instant counts as expired.
 */
export function secondsLeft(expiresAt: string, now: Date): number {
  const ms = Date.parse(expiresAt) - now.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / SECOND_MS));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function split(seconds: number): { hours: number; minutes: number; secs: number } {
  const total = Math.max(0, Math.trunc(seconds));
  return {
    hours: Math.trunc(total / HOUR_S),
    minutes: Math.trunc((total % HOUR_S) / MINUTE_S),
    secs: total % MINUTE_S,
  };
}

/** 84 → "1:24", 5 → "0:05", 3725 → "1:02:05" */
export function formatCountdown(seconds: number): string {
  const { hours, minutes, secs } = split(seconds);
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${minutes}:${pad2(secs)}`;
}

const unit = (n: number, singular: string): string => `${n} ${singular}${n === 1 ? '' : 's'}`;

/** For screen readers: 84 → "1 minute 24 seconds", 120 → "2 minutes". */
export function spokenCountdown(seconds: number): string {
  const { hours, minutes, secs } = split(seconds);
  const parts = [
    hours > 0 ? unit(hours, 'hour') : null,
    minutes > 0 ? unit(minutes, 'minute') : null,
    secs > 0 ? unit(secs, 'second') : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' ') : unit(0, 'second');
}

export const isUrgent = (seconds: number): boolean => seconds > 0 && seconds <= URGENT_SECONDS;

/** The longest the expiry clock sleeps in one go (keeps setTimeout well inside its range). */
export const MAX_EXPIRY_WAIT_MS = 60_000;

/**
 * Milliseconds until the soonest of `expiresAts` still ahead of `now` closes (at least 0, at most
 * MAX_EXPIRY_WAIT_MS), or null when none is ahead. Lets a list re-render when an offer drops out
 * instead of every second.
 */
export function nextExpiryDelayMs(expiresAts: readonly string[], now: Date): number | null {
  const ahead = expiresAts
    .map((iso) => Date.parse(iso) - now.getTime())
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (ahead.length === 0) return null;
  return Math.min(MAX_EXPIRY_WAIT_MS, ...ahead);
}
