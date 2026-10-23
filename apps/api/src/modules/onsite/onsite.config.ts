/**
 * ADR-0013 v1 numbers in one place so ops can tune them. Distances in metres, durations in minutes.
 * Two different 15-minute windows live here and must never be merged (SPEC-AUDIT SA-05): the
 * no-show alert (photographer late) and — in the ruleset, not here — the waiting grace (client late).
 */
export const ONSITE_CONFIG = {
  geofence: {
    /** G-15: check-in/out within 150 m of the venue. */
    radiusM: 150,
    /** A fix worse than this cannot prove a 150 m fence. */
    maxAccuracyM: 100,
    /** How far an un-geocoded fallback point may be from the fix (accepted unverified, D3). */
    fallbackMaxM: { PINCODE_CENTROID: 3_000, CITY_CENTRE: 30_000 },
  },
  /** En-route and check-in open this long before the scheduled start (D2). */
  openLeadMinutes: 180,
  offline: {
    /** An offline device time older than this is not trusted (D5). */
    maxAgeMinutes: 6 * 60,
    /** A device clock this far ahead is clamped to the server time; further is ignored. */
    maxFutureSkewMs: 2 * 60_000,
  },
  extension: {
    /** G-16: one-hour blocks. */
    blockMinutes: 60,
    maxApproved: 4,
    /** An unanswered request lapses after this. */
    expiryMinutes: 10,
  },
  waiting: {
    /** Waiting beyond this is T&C §3.8 non-attendance territory: capped, ops alerted. */
    capMinutes: 60,
  },
  noShow: {
    /** v0.2 §9: no check-in by start + 15 min → alert. */
    alertAfterMinutes: 15,
    /** … + 5 min more → escalate (penalty + emergency re-broadcast). */
    escalateAfterMinutes: 20,
    escalateAfterAlertMinutes: 5,
    /** A replacement accepted late gets this long to arrive (the calendar travel buffer). */
    replacementTravelMinutes: 90,
    /** The sweep only looks back this far; older stuck bookings are the ops desk's (and S8 alerts'). */
    sweepLookbackHours: 12,
  },
  /** T&C §3.6b: a replacement checking in later than start + this is late (25% credit, S8). */
  lateReplacementGraceMinutes: 15,
  lateReplacementCreditBps: 2_500,
  /** T&C §3.8: the client may be reported absent 60 min after the start. */
  clientAbsentAfterMinutes: 60,
  delivery: { standardHours: 48, rushHours: 24, rushAddonCode: 'RUSH_24H' },
  sweepBatchSize: 50,
  /** Earnings list length (G-23 per-job breakdown). */
  earningsJobs: 50,
} as const;

/** Booking statuses an on-site report (waiting, incidents) may be made in. */
export const ON_SITE_STATUSES = ['CHECKED_IN', 'IN_PROGRESS'] as const;
