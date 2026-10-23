import type { EmergencyBand } from '@clickco/contracts';

/**
 * ADR-0010 v1 numbers, in one place so ops can tune them. Distances in km, windows in seconds.
 * `offers: null` = every remaining eligible photographer; `radiusKm: null` = city-wide (each
 * photographer's own service radius still applies).
 */
export interface CascadeStep {
  readonly radiusKm: number | null;
  readonly offers: number | null;
  readonly windowSeconds: number;
}

export const DISPATCH_CONFIG = {
  cascade: [
    { radiusKm: 8, offers: 3, windowSeconds: 120 },
    { radiusKm: 15, offers: 5, windowSeconds: 120 },
    { radiusKm: 25, offers: 10, windowSeconds: 180 },
    { radiusKm: null, offers: null, windowSeconds: 300 },
  ] satisfies readonly CascadeStep[],
  /** v0.2 §8: one emergency wave to every opted-in photographer, first accept wins. */
  broadcastWindowSeconds: 600,
  /**
   * What dispatch_rounds.radius_km (NOT NULL) records for a city-wide wave. Wider than any launch
   * city; the per-photographer service radius is the real limit.
   */
  cityWideRadiusKm: 100,
  /** Assignment calendar block = shoot ± travel buffer (G-28). */
  travelBufferMinutes: 90,
  /** Redis first-accept lock TTL (ADR-0010 accept step 1). */
  acceptLockMs: 15_000,
  /** The sweeper only closes waves this long past their window (the delayed job normally wins). */
  sweepGraceSeconds: 5,
  sweepBatchSize: 50,
  /**
   * The deadline sweep looks at DISPATCHING bookings starting within this horizon; each one's
   * own deadline (start − auto_refund_minutes_before, from its ruleset) decides (ADR-0012 D1).
   */
  deadlineSweepHorizonMinutes: 24 * 60,
  ranking: {
    proximity: 0.35,
    rating: 0.25,
    acceptance: 0.2,
    onTimeUpload: 0.15,
    noShowPenalty: 0.05,
    noShowCap: 3,
    /** New photographers are not buried: a missing metric counts as 0.8. */
    missingMetric: 0.8,
  },
} as const;

/**
 * Idempotency keys on /pro/* live 10 minutes (ADR-0012): long enough for a flaky-network retry,
 * short enough that a stale replay is not served the next day.
 */
export const PRO_IDEMPOTENCY_TTL_MS = 10 * 60_000;

/** Bands that skip the cascade and broadcast (v0.2 §8). */
export const EMERGENCY_BANDS: readonly EmergencyBand[] = ['SAME_DAY', 'HOURS_3_8', 'HOURS_UNDER_3'];
