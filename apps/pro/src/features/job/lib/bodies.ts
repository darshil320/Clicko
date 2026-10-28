import type {
  CheckInBody,
  CheckOutBody,
  ClientAbsentBody,
  IncidentBody,
  LogWaitingBody,
  ProAssignmentDetail,
} from '@clickco/contracts';
import { accuracyLevel, type DeviceFix, MAX_ACCURACY_M } from '@/shared/location/fix';
import { MOCKED_LOCATION_MESSAGE, tooRoughMessage } from './errors';

/**
 * Request bodies for on-site actions, built from a device fix and the moment the photographer
 * tapped (`deviceTs`, ADR-0013 D4). Bodies leave here online (`offline: false`); the queue marks
 * them offline if it has to hold them (shared/offline/queue.ts).
 */

/** Contract limits (packages/contracts onsite.ts / dispatch.ts). */
const NOTE_MIN = 3;
const NOTE_MAX = 1000;
const MAX_FRAMES = 100_000;
const MIN_WAITING_MINUTES = 1;
const MAX_WAITING_MINUTES = 240;
/** IncidentBody.accuracyM is capped at 10 km; a rougher figure is dropped, never refused. */
const MAX_REPORTED_ACCURACY_M = 10_000;

const WHOLE_NUMBER = /^\d+$/;

/**
 * Check-in, check-out and client-absent are geofenced: a mocked or too-rough fix would only be
 * refused by the server (or, offline, hours later), so it is not sent.
 */
export function geofencedFixProblem(fix: DeviceFix): string | null {
  if (fix.mocked) return MOCKED_LOCATION_MESSAGE;
  if (accuracyLevel(fix.accuracyM) === 'POOR') return tooRoughMessage(MAX_ACCURACY_M);
  return null;
}

const geoFix = (fix: DeviceFix, tappedAt: Date) => ({
  lat: fix.lat,
  lng: fix.lng,
  accuracyM: fix.accuracyM,
  mocked: fix.mocked,
  deviceTs: tappedAt.toISOString(),
  offline: false,
});

export const checkInBody = (fix: DeviceFix, tappedAt: Date): CheckInBody => geoFix(fix, tappedAt);

export const checkOutBody = (fix: DeviceFix, frames: number, tappedAt: Date): CheckOutBody => ({
  ...geoFix(fix, tappedAt),
  declaredFrameCount: frames,
});

export const clientAbsentBody = (
  fix: DeviceFix,
  note: string,
  tappedAt: Date,
): ClientAbsentBody => ({ ...geoFix(fix, tappedAt), note: note.trim() });

export const waitingBody = (
  fix: DeviceFix,
  minutes: number,
  note: string,
  tappedAt: Date,
): LogWaitingBody => ({
  minutes,
  note: note.trim(),
  lat: fix.lat,
  lng: fix.lng,
  deviceTs: tappedAt.toISOString(),
});

/** Safety first (ADR-0013 D10): whatever the fix, the report goes. */
export function incidentBody(fix: DeviceFix, note: string, tappedAt: Date): IncidentBody {
  return {
    note: note.trim(),
    lat: fix.lat,
    lng: fix.lng,
    ...(fix.accuracyM <= MAX_REPORTED_ACCURACY_M ? { accuracyM: fix.accuracyM } : {}),
    deviceTs: tappedAt.toISOString(),
  };
}

function wholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}

/** The camera's frame counter: a whole number, 0 to 100,000. */
export const parseFrameCount = (text: string): number | null => wholeNumber(text, 0, MAX_FRAMES);

/** Waiting minutes: a whole number, 1 to 240 (the server also caps it at the time elapsed). */
export const parseWaitingMinutes = (text: string): number | null =>
  wholeNumber(text, MIN_WAITING_MINUTES, MAX_WAITING_MINUTES);

/** Notes on reports and waiting (max 1000) and the cancel reason (max 500, CancelAssignmentBody). */
export const CANCEL_REASON_MAX = 500;

export function noteError(text: string, max: number = NOTE_MAX): string | null {
  const length = text.trim().length;
  if (length < NOTE_MIN) return `Add a few words — at least ${NOTE_MIN} characters.`;
  if (length > max) return `Keep it shorter — ${max} characters at most.`;
  return null;
}

const MAPS_DIRECTIONS = 'https://www.google.com/maps/dir/?api=1&destination=';

/** Google Maps directions to the venue, or null once the API hides the address (after the shoot). */
export function navigateUrl(venue: ProAssignmentDetail['venue']): string | null {
  if (!venue.address) return null;
  const destination = [venue.address, venue.areaName, `${venue.cityName} ${venue.pincode}`]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return `${MAPS_DIRECTIONS}${encodeURIComponent(destination)}`;
}
