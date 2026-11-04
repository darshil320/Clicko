/**
 * Every BullMQ queue and job name in the API. Scheduled work lives in src/jobs/ as processors and
 * is registered here (apps/api/CLAUDE.md). Names never contain ':' (BullMQ reserves it).
 */
export const QUEUE = {
  OUTBOX: 'outbox',
  DISPATCH: 'dispatch',
  AUTH: 'auth',
  ONSITE: 'onsite',
  MEDIA: 'media',
  /** JPEG export only: CPU-bound, kept off the queue the monitors and the reaper run on. */
  MEDIA_EXPORT: 'media-export',
  SLA: 'sla',
  /** Checkout housekeeping (audit L3: stale ADVANCE_PENDING bookings). */
  CHECKOUT: 'checkout',
  /** Lifecycle messages: one job per recipient of a domain event (ADR-0027 D2). */
  NOTIFICATIONS: 'notifications',
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export const JOB = {
  /** Repeatable: publishes the transactional outbox to in-process subscribers. */
  OUTBOX_PUBLISH: 'outbox.publish',
  /** Delayed: a dispatch wave's offer window has closed (ADR-0010 cascade). */
  DISPATCH_WAVE_EXPIRY: 'dispatch.wave-expiry',
  /** Delayed: an unfilled booking at scheduled_start − auto_refund_minutes_before (ADR-0012 D1). */
  DISPATCH_DEADLINE: 'dispatch.deadline',
  /** Repeatable: closes waves and deadlines whose job was lost (Redis outage after commit). */
  DISPATCH_SWEEP: 'dispatch.sweep',
  /** Immediate: sends an OTP SMS off the request path (ADR-0012 D8). */
  AUTH_OTP_SMS: 'auth.otp-sms',
  /** Delayed: start + 15 min (alert) / + 20 min (escalate) without a check-in (ADR-0013 D11). */
  ONSITE_NO_SHOW_CHECK: 'onsite.no-show-check',
  /** Delayed: an extension request's 10 minutes are up (ADR-0013 D8). */
  ONSITE_EXTENSION_EXPIRY: 'onsite.extension-expiry',
  /** Repeatable: re-runs no-show checks whose job was lost. */
  ONSITE_SWEEP: 'onsite.sweep',
  /** Immediate: RAW → JPEG export for a PROCESSING booking, then → QA (ADR-0014 D4). */
  MEDIA_JPEG_EXPORT: 'media.jpeg-export',
  /** Repeatable (weekly): declared vs stored vs provider file counts per booking (ADR-0014 D5). */
  MEDIA_INTEGRITY_AUDIT: 'media.integrity-audit',
  /** Repeatable (15 min): storage usage sample + 60/75/90 % alerts (ADR-0014 D5). */
  MEDIA_QUOTA_MONITOR: 'media.quota-monitor',
  /** Repeatable (hourly): reclaims staged parts of upload sessions idle for 24 h (security review M5). */
  MEDIA_UPLOAD_REAPER: 'media.upload-reaper',
  /** Delayed: one SLA clock is due (ADR-0016 D6). */
  SLA_CLOCK_DUE: 'sla.clock-due',
  /** Repeatable: fires overdue armed clocks whose job was lost. */
  SLA_SWEEP: 'sla.sweep',
  /**
   * Repeatable (5 min): cancels ADVANCE_PENDING bookings whose payment window closed (quote
   * expiry + grace), which releases their promo redemption (audit L3).
   */
  CHECKOUT_STALE_SWEEP: 'checkout.stale-advance-sweep',
  /**
   * Immediate, or delayed to 08:00 IST for a non-essential message in quiet hours: one recipient's
   * message for one domain event (WhatsApp → SMS fallback, push alongside). ADR-0027 D2.
   */
  NOTIFICATION_SEND: 'notifications.send',
} as const;
export type JobName = (typeof JOB)[keyof typeof JOB];

export const QUEUE_OF: Readonly<Record<JobName, QueueName>> = {
  [JOB.OUTBOX_PUBLISH]: QUEUE.OUTBOX,
  [JOB.DISPATCH_WAVE_EXPIRY]: QUEUE.DISPATCH,
  [JOB.DISPATCH_DEADLINE]: QUEUE.DISPATCH,
  [JOB.DISPATCH_SWEEP]: QUEUE.DISPATCH,
  [JOB.AUTH_OTP_SMS]: QUEUE.AUTH,
  [JOB.ONSITE_NO_SHOW_CHECK]: QUEUE.ONSITE,
  [JOB.ONSITE_EXTENSION_EXPIRY]: QUEUE.ONSITE,
  [JOB.ONSITE_SWEEP]: QUEUE.ONSITE,
  [JOB.MEDIA_JPEG_EXPORT]: QUEUE.MEDIA_EXPORT,
  [JOB.MEDIA_INTEGRITY_AUDIT]: QUEUE.MEDIA,
  [JOB.MEDIA_QUOTA_MONITOR]: QUEUE.MEDIA,
  [JOB.MEDIA_UPLOAD_REAPER]: QUEUE.MEDIA,
  [JOB.SLA_CLOCK_DUE]: QUEUE.SLA,
  [JOB.SLA_SWEEP]: QUEUE.SLA,
  [JOB.CHECKOUT_STALE_SWEEP]: QUEUE.CHECKOUT,
  [JOB.NOTIFICATION_SEND]: QUEUE.NOTIFICATIONS,
};

export interface JobOptions {
  readonly attempts: number;
  readonly backoffMs: number;
}

/** Per-job retry policy; anything absent uses the queue default (5 tries, 5 s exponential). */
export const JOB_OPTIONS: Partial<Readonly<Record<JobName, JobOptions>>> = {
  // An OTP lives 5 minutes: 5 s, 10 s, then give up (reported; the user can ask for a new code).
  // Only retryable failures retry (OtpSmsProcessor). A timeout or 5xx may still have sent the SMS
  // and the budgets (audit M5) count one per request, so at most 3 tries: duplicates stay few.
  [JOB.AUTH_OTP_SMS]: { attempts: 3, backoffMs: 5_000 },
  // A failed export (corrupt RAW, missing darktable) alerts ops on the first failure: 30 s … 8 min.
  [JOB.MEDIA_JPEG_EXPORT]: { attempts: 5, backoffMs: 30_000 },
  // A provider outage (WhatsApp, MSG91, Expo): 20 s, 40 s, 80 s, 160 s, 320 s — about 10 minutes
  // in all; every failed attempt is a FAILED notification_sends row.
  [JOB.NOTIFICATION_SEND]: { attempts: 6, backoffMs: 20_000 },
};

export interface RepeatableJob {
  readonly job: JobName;
  readonly everyMs: number;
}

/** ADR-0010: the outbox is polled every 2 s. */
export const REPEATABLE_JOBS: readonly RepeatableJob[] = [
  { job: JOB.OUTBOX_PUBLISH, everyMs: 2_000 },
  { job: JOB.DISPATCH_SWEEP, everyMs: 30_000 },
  { job: JOB.ONSITE_SWEEP, everyMs: 60_000 },
  { job: JOB.MEDIA_INTEGRITY_AUDIT, everyMs: 7 * 24 * 3_600_000 },
  { job: JOB.MEDIA_QUOTA_MONITOR, everyMs: 15 * 60_000 },
  { job: JOB.MEDIA_UPLOAD_REAPER, everyMs: 60 * 60_000 },
  { job: JOB.SLA_SWEEP, everyMs: 60_000 },
  { job: JOB.CHECKOUT_STALE_SWEEP, everyMs: 5 * 60_000 },
];

/** The outbox is drained by one job at a time; dispatch timers may overlap (they lock rows). */
export const WORKER_CONCURRENCY: Readonly<Record<QueueName, number>> = {
  [QUEUE.OUTBOX]: 1,
  [QUEUE.DISPATCH]: 4,
  [QUEUE.AUTH]: 4,
  [QUEUE.ONSITE]: 4,
  [QUEUE.MEDIA]: 2,
  // JPEG export is CPU-bound (darktable): two at a time per worker.
  [QUEUE.MEDIA_EXPORT]: 2,
  [QUEUE.SLA]: 4,
  [QUEUE.CHECKOUT]: 1,
  [QUEUE.NOTIFICATIONS]: 4,
};
