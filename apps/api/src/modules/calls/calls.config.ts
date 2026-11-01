const MINUTE_MS = 60_000;

/** Masked calls (ADR-0027 D3). */
export const CALLS_CONFIG = {
  /** The binding stays open this long after check-out (and after an access-denied / unsafe end). */
  openAfterShootMs: 120 * MINUTE_MS,
  /** A call is cut by the provider after this long. */
  timeLimitSeconds: 30 * 60,
  /** At most this many call requests per caller and binding within `rateWindowMs`… */
  maxCallsPerWindow: 5,
  rateWindowMs: 10 * MINUTE_MS,
  /** …and this many within `dayWindowMs` (a binding can stay open for days before the shoot). */
  maxCallsPerDay: 20,
  dayWindowMs: 24 * 60 * MINUTE_MS,
  /** The console adapter's pretend ExoPhone (development and test only). */
  consoleVirtualNumber: '+910000000000',
  /** Exotel's status callback path; the secret follows it. */
  webhookPath: '/webhooks/exotel/call-status',
} as const;
