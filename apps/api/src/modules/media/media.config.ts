import type { BookingStatus } from '@clickco/contracts';

/** Sprint 7 media numbers (ADR-0014). One object so ops can tune them. */
export const MEDIA_CONFIG = {
  /** Idempotency-Key lifetime on /pro/* media routes (as dispatch, ADR-0012). */
  proIdempotencyTtlMs: 10 * 60_000,
  /** Per-IP limit on the parts route: the global 120/min would stall a 600-file card. */
  partsPerMinutePerIp: 1_200,
  /** Per-IP limit on the other media routes (file completes run once per file). */
  routesPerMinutePerIp: 900,
  /** New sessions are refused when today's bytes + declared bytes pass this share of the ceiling. */
  dailyCeilingRefuseBps: 8_500,
  /** Storage alert thresholds (v0.2 §4) — MEDIUM, HIGH, CRITICAL. */
  storageAlertBps: [6_000, 7_500, 9_000] as const,
  /** Parallel StoragePort session creations when a manifest opens. */
  adapterSessionConcurrency: 16,
  /** RAW files fetched per export query. */
  exportBatch: 50,
  /** Bookings walked per integrity-audit run. */
  auditBatch: 500,
  /** Listed ids in an audit's `detail` (bounded jsonb). */
  auditDetailLimit: 20,
  /** One darktable-cli run per file may take this long before it is killed. */
  darktableTimeoutMs: 120_000,
  /** An open session idle this long has its staged parts reclaimed (security review M5). */
  idleSessionReclaimHours: 24,
  /** Sessions looked at per reaper run. */
  reaperBatch: 100,
} as const;

/** Where a new upload session may open (ADR-0014 D2). */
export const UPLOADABLE_STATUSES: readonly BookingStatus[] = [
  'CHECKED_OUT',
  'UNSAFE_SITE', // ADR-0016 D11
  'UPLOADING',
];

/** What the portal's Jobs and Status pages show. */
export const UPLOAD_JOB_STATUSES: readonly BookingStatus[] = [
  'CHECKED_OUT',
  'UNSAFE_SITE',
  'UPLOADING',
  'PROCESSING',
  'QA',
];

/** Fixed aggregate ids for storage-wide ops alerts (domain_events.aggregate_id is a uuid). */
export const STORAGE_AGGREGATE_ID: Readonly<Record<string, string>> = {
  LOCAL_DISK: '00000000-0000-4000-8000-00000000a001',
  GOOGLE_DRIVE: '00000000-0000-4000-8000-00000000a002',
};
