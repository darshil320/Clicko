/**
 * Device location fixes, as the on-site API wants them (GeoFixBody). Pure: no expo-location here,
 * so it is unit-tested. The 150 m decision is the server's (ADR-0024 D4); the app only judges
 * whether a fix is good enough to send.
 */

/** The server refuses fixes rougher than this (ADR-0013 D3, 422 LOCATION_TOO_INACCURATE). */
export const MAX_ACCURACY_M = 100;
/** Below this the fix is comfortably precise for a 150 m fence. */
const GOOD_ACCURACY_M = 30;

export interface DeviceFix {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyM: number;
  /** The OS reports a mock-location provider (Android); the server refuses these. */
  readonly mocked: boolean;
  /** When the fix was taken (ISO). */
  readonly takenAt: string;
}

/** The subset of expo-location's LocationObject this needs. */
export interface RawLocation {
  readonly coords: {
    readonly latitude: number;
    readonly longitude: number;
    readonly accuracy: number | null;
  };
  readonly timestamp: number;
  readonly mocked?: boolean;
}

/** null when the platform gave no accuracy: an unknown accuracy is never sent as "precise". */
export function toDeviceFix(raw: RawLocation): DeviceFix | null {
  const { latitude, longitude, accuracy } = raw.coords;
  if (accuracy === null || !Number.isFinite(accuracy) || accuracy <= 0) return null;
  return {
    lat: latitude,
    lng: longitude,
    accuracyM: Math.round(accuracy * 10) / 10,
    mocked: raw.mocked === true,
    takenAt: new Date(raw.timestamp).toISOString(),
  };
}

/** A fix older than this is the OS's cached position, not where the photographer is now. */
export const MAX_FIX_AGE_MS = 30_000;

export function isFresh(fix: DeviceFix, now: Date, maxAgeMs = MAX_FIX_AGE_MS): boolean {
  return now.getTime() - Date.parse(fix.takenAt) <= maxAgeMs;
}

export type AccuracyLevel = 'GOOD' | 'FAIR' | 'POOR';

export function accuracyLevel(accuracyM: number): AccuracyLevel {
  if (accuracyM <= GOOD_ACCURACY_M) return 'GOOD';
  if (accuracyM <= MAX_ACCURACY_M) return 'FAIR';
  return 'POOR';
}

/** "±12 m" */
export const formatAccuracy = (accuracyM: number): string => `±${Math.round(accuracyM)} m`;
