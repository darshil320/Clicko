/** Engine-wide fixed scales. Rates and multipliers themselves always come from the Ruleset. */

/** 10000 bps = 1.00×. */
export const BPS_SCALE = 10_000n;
export const NEUTRAL_BPS = 10_000;

/** Durations are carried as integer half-hours: 2.5 h → 5n. */
export const HALF_HOURS_PER_HOUR = 2n;

/** doc 05 §3 step 3: minimum 2.0 hours when the ruleset has no deliverable row for the tier. */
export const DEFAULT_MIN_HALF_HOURS = 4;

export const METRES_PER_KM = 1_000n;

/** doc 05 §3 step 12: quote_expires_at = now + 15 minutes. */
export const QUOTE_TTL_MS = 15 * 60_000;

export const HOUR_MS = 3_600_000;
