-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0014 · performance indexes (ADR-0027 D6, performance audit)
-- Measured on a 200k-booking / 1M-event synthetic database. Every index serves a named
-- read; the reads were changed so the planner can match them:
--   * the ops alert feed and review list (modules/ops/ops-alerts.reader.ts) read
--     domain_events newest first under the feed's WHERE. The booking-id expression
--     index mirrors the reader's CASE byte for byte, with the UUID pattern inlined as
--     a constant — a bind parameter would never match it.
--   * the staff booking board orders non-draft bookings by (scheduled_start, id).
--   * the payout UTR confirm checks every UTR in one `utr = ANY($1)` query; the GiST
--     exclusion indexes from 0012 can answer it but a B-tree is ~10x cheaper per probe.
--   * the incident desk counts open field reports per booking and kind.
--   * the board's free-text search (name / phone substring) uses pg_trgm (0001).
--   * the dispatch sweeper scans open rounds by start time.
-- The runner applies a file in one transaction, so no CONCURRENTLY: on a large table
-- apply this in a quiet window (each CREATE INDEX holds a SHARE lock on its table).
-- Additive only.
-- ============================================================================
CREATE INDEX domain_events_alert_feed_idx
  ON domain_events (occurred_at DESC, id DESC)
  WHERE event_type = 'ops.alert' OR event_type LIKE '%.needs_review';

CREATE INDEX domain_events_alert_booking_idx
  ON domain_events ((CASE WHEN aggregate_kind = 'booking' THEN aggregate_id
                          WHEN payload->>'booking_id' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                            THEN (payload->>'booking_id')::uuid
                     END))
  WHERE event_type = 'ops.alert' OR event_type LIKE '%.needs_review';

CREATE INDEX bookings_board_idx
  ON bookings (scheduled_start DESC, id DESC) WHERE status <> 'DRAFT';

CREATE INDEX payouts_utr_idx ON payouts (utr) WHERE utr IS NOT NULL;

CREATE INDEX assignment_events_reports_idx
  ON assignment_events (booking_id, kind)
  WHERE kind IN ('ACCESS_DENIED_REPORTED', 'UNSAFE_REPORTED', 'CLIENT_ABSENT_REPORTED');

CREATE INDEX bookings_search_trgm
  ON bookings USING gin (booker_name gin_trgm_ops, subject_name gin_trgm_ops,
                         booker_phone gin_trgm_ops, subject_phone gin_trgm_ops);

CREATE INDEX dispatch_rounds_open_idx ON dispatch_rounds (started_at) WHERE ended_at IS NULL;
