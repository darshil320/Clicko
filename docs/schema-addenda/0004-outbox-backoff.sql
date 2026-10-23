-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0004 · outbox retry backoff (ADR-0012 D9)
-- A failing subscriber is retried with exponential backoff instead of every
-- poll: next_attempt_at NULL = due now. publish_attempts / last_error already
-- exist (schema §13). Additive only.
-- ============================================================================
ALTER TABLE domain_events
  ADD COLUMN next_attempt_at timestamptz;

-- The poller's hot path: unpublished events by when they are next due.
CREATE INDEX domain_events_due_idx ON domain_events (next_attempt_at)
  WHERE published_at IS NULL;
