-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0018 · outbox claim token (ADR-0027 D6b, recorded
-- LOW: "a claim token that the settle updates must match"). Additive only.
--
--   domain_events (§13; next_attempt_at from 0004)
--     + claim_token  a random uuid the publisher writes when it claims an event,
--                    together with the lease in next_attempt_at. Settling the
--                    event (published, or a failure with its backoff) and handing
--                    an unstarted claim back all require the token to still
--                    match, and clear it. A tick whose delivery outlived its
--                    lease, after another tick claimed the event again, changes
--                    nothing: it can neither mark the event published under the
--                    newer delivery nor overwrite the newer lease with its own
--                    backoff. NULL = not claimed (or settled).
--
-- No index: every statement that matches the token also matches the primary key.
--
-- Grants: migration 0011 limits clickco_app to UPDATE on the outbox delivery
-- columns of domain_events; the new column joins that list here.
-- ============================================================================

ALTER TABLE domain_events
  ADD COLUMN claim_token uuid;

GRANT UPDATE (claim_token) ON domain_events TO clickco_app;
