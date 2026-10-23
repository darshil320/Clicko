/**
 * Every BullMQ queue and job name in the API. Scheduled work lives in src/jobs/ as processors and
 * is registered here (apps/api/CLAUDE.md). Names never contain ':' (BullMQ reserves it).
 */
export const QUEUE = {
  OUTBOX: 'outbox',
  DISPATCH: 'dispatch',
  AUTH: 'auth',
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
} as const;
export type JobName = (typeof JOB)[keyof typeof JOB];

export const QUEUE_OF: Readonly<Record<JobName, QueueName>> = {
  [JOB.OUTBOX_PUBLISH]: QUEUE.OUTBOX,
  [JOB.DISPATCH_WAVE_EXPIRY]: QUEUE.DISPATCH,
  [JOB.DISPATCH_DEADLINE]: QUEUE.DISPATCH,
  [JOB.DISPATCH_SWEEP]: QUEUE.DISPATCH,
  [JOB.AUTH_OTP_SMS]: QUEUE.AUTH,
};

export interface JobOptions {
  readonly attempts: number;
  readonly backoffMs: number;
}

/** Per-job retry policy; anything absent uses the queue default (5 tries, 5 s exponential). */
export const JOB_OPTIONS: Partial<Readonly<Record<JobName, JobOptions>>> = {
  // An OTP lives 5 minutes: 2 s, 4 s, 8 s, 16 s, then give up (logged; the code expires).
  [JOB.AUTH_OTP_SMS]: { attempts: 5, backoffMs: 2_000 },
};

export interface RepeatableJob {
  readonly job: JobName;
  readonly everyMs: number;
}

/** ADR-0010: the outbox is polled every 2 s. */
export const REPEATABLE_JOBS: readonly RepeatableJob[] = [
  { job: JOB.OUTBOX_PUBLISH, everyMs: 2_000 },
  { job: JOB.DISPATCH_SWEEP, everyMs: 30_000 },
];

/** The outbox is drained by one job at a time; dispatch timers may overlap (they lock rows). */
export const WORKER_CONCURRENCY: Readonly<Record<QueueName, number>> = {
  [QUEUE.OUTBOX]: 1,
  [QUEUE.DISPATCH]: 4,
  [QUEUE.AUTH]: 4,
};
