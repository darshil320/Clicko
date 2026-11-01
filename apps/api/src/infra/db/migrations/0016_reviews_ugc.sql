-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0016 · reviews and UGC safety (ADR-0027 D4).
-- Additive only.
--
--   reviews (§12, unchanged otherwise)
--                             + updated_at: a client edits their review for 7 days
--                             + photographer_id: who a CLIENT_TO_PRO review is about
--                               (the photographer of the booking's shoot), so the
--                               reviews module computes a rating from its own table
--                             + length limits on comment and moderation_note
--   moderation_reports        a review, a client or a photographer reported by a
--                             client or a photographer; the moderation desk's queue
--                             (city-scoped). One OPEN report per reporter and target.
--                             A REVIEW report keeps the review as it stood when filed
--                             (reported_rating / reported_comment): the author cannot
--                             swap the text under the desk.
--   client_photographer_blocks
--                             a client never gets this photographer again: dispatch
--                             excludes them from that client's bookings. One row per
--                             pair; unblocking deletes it.
--   moderation_actions        append-only: every staff decision on a report (hide,
--                             keep, warn, dismiss). A person's warnings are counted
--                             here.
--
-- Grants: migration 0011's default privileges give clickco_app full DML on new
-- tables; moderation_actions has UPDATE/DELETE/TRUNCATE revoked here and its own
-- BEFORE UPDATE/DELETE/TRUNCATE triggers (apps/api/CLAUDE.md "Database roles").
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. reviews: edits, the photographer reviewed, length limits
--    (no code wrote reviews before this migration, so the checks hold at once)
-- ----------------------------------------------------------------------------
ALTER TABLE reviews
  ADD COLUMN updated_at      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN photographer_id uuid REFERENCES photographers(id);

ALTER TABLE reviews
  ADD CONSTRAINT review_comment_length
    CHECK (comment IS NULL OR char_length(comment) <= 1000),
  ADD CONSTRAINT review_moderation_note_length
    CHECK (moderation_note IS NULL OR char_length(moderation_note) <= 1000),
  ADD CONSTRAINT review_client_to_pro_names_photographer
    CHECK (direction <> 'CLIENT_TO_PRO' OR photographer_id IS NOT NULL),
  ADD CONSTRAINT review_edited_after_written CHECK (updated_at >= created_at);

-- a photographer's published rating (photographer_metrics.rating_avg_bps / rating_count)
CREATE INDEX reviews_photographer_rating_idx
  ON reviews (photographer_id)
  WHERE direction = 'CLIENT_TO_PRO' AND is_published;


-- ----------------------------------------------------------------------------
-- 2. moderation_reports
-- ----------------------------------------------------------------------------
CREATE TABLE moderation_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_kind   text NOT NULL,
  reporter_id     uuid NOT NULL,
  target_kind     text NOT NULL,
  target_id       uuid NOT NULL,
  -- the booking the reporter and the target shared (a review's own booking)
  booking_id      uuid REFERENCES bookings(id),
  -- the desk's city scope (ADR-0025 D3): the booking's city
  city_id         uuid NOT NULL REFERENCES cities(id),
  reason          text NOT NULL,
  note            text,
  -- REVIEW only: the review as it stood when this report was filed
  reported_rating  smallint,
  reported_comment text,
  status          text NOT NULL DEFAULT 'OPEN',
  decision        text,
  decision_note   text,
  decided_by      uuid REFERENCES staff_users(id),
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT moderation_reports_reporter_valid
    CHECK (reporter_kind IN ('USER', 'PHOTOGRAPHER')),
  CONSTRAINT moderation_reports_target_valid
    CHECK (target_kind IN ('REVIEW', 'USER', 'PHOTOGRAPHER')),
  CONSTRAINT moderation_reports_not_self
    CHECK (NOT (reporter_kind = target_kind AND reporter_id = target_id)),
  CONSTRAINT moderation_reports_reason_valid
    CHECK (reason IN ('ABUSIVE', 'HARASSMENT', 'SPAM', 'FALSE_INFORMATION',
                      'PERSONAL_INFORMATION', 'UNSAFE_BEHAVIOUR', 'OTHER')),
  CONSTRAINT moderation_reports_note_length
    CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT moderation_reports_snapshot_is_review CHECK (
    (target_kind = 'REVIEW') = (reported_rating IS NOT NULL)
    AND (target_kind = 'REVIEW' OR reported_comment IS NULL)
  ),
  CONSTRAINT moderation_reports_snapshot_rating
    CHECK (reported_rating IS NULL OR reported_rating BETWEEN 1 AND 5),
  CONSTRAINT moderation_reports_snapshot_comment_length
    CHECK (reported_comment IS NULL OR char_length(reported_comment) <= 1000),
  CONSTRAINT moderation_reports_status_valid
    CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED')),
  CONSTRAINT moderation_reports_decision_valid
    CHECK (decision IS NULL OR decision IN ('HIDE', 'KEEP', 'WARN', 'DISMISS')),
  -- OPEN has no decision; a decided report has all of it, and HIDE/WARN are the actions
  CONSTRAINT moderation_reports_decided_consistency CHECK (
    (status = 'OPEN' AND decision IS NULL AND decision_note IS NULL
       AND decided_by IS NULL AND decided_at IS NULL)
    OR (status <> 'OPEN' AND decision IS NOT NULL AND decision_note IS NOT NULL
       AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND (status = 'ACTIONED') = (decision IN ('HIDE', 'WARN')))
  ),
  CONSTRAINT moderation_reports_decision_note_length
    CHECK (decision_note IS NULL OR char_length(decision_note) <= 1000)
);
CREATE UNIQUE INDEX moderation_reports_one_open
  ON moderation_reports (reporter_kind, reporter_id, target_kind, target_id)
  WHERE status = 'OPEN';
-- the desk: open reports oldest first, decided ones newest first
CREATE INDEX moderation_reports_open_idx
  ON moderation_reports (created_at, id) WHERE status = 'OPEN';
CREATE INDEX moderation_reports_decided_idx
  ON moderation_reports (decided_at DESC, id DESC) WHERE status <> 'OPEN';
CREATE INDEX moderation_reports_target_idx
  ON moderation_reports (target_kind, target_id, status);
-- the per-reporter daily cap
CREATE INDEX moderation_reports_reporter_idx
  ON moderation_reports (reporter_kind, reporter_id, created_at);


-- ----------------------------------------------------------------------------
-- 3. client_photographer_blocks
-- ----------------------------------------------------------------------------
CREATE TABLE client_photographer_blocks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photographer_id  uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- one block per pair; also the dispatch lookup (a booking's client → blocked ids)
CREATE UNIQUE INDEX client_photographer_blocks_pair_uq
  ON client_photographer_blocks (user_id, photographer_id);


-- ----------------------------------------------------------------------------
-- 4. moderation_actions (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE moderation_actions (
  id              bigserial PRIMARY KEY,
  report_id       uuid NOT NULL REFERENCES moderation_reports(id),
  decision        text NOT NULL,
  target_kind     text NOT NULL,
  target_id       uuid NOT NULL,
  -- WARN only: the person warned (a review's author for a REVIEW report)
  warned_kind     text,
  warned_id       uuid,
  staff_id        uuid NOT NULL REFERENCES staff_users(id),
  city_id         uuid NOT NULL REFERENCES cities(id),
  note            text NOT NULL,
  -- this report and the other open reports on the same target it closed
  reports_closed  integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT moderation_actions_decision_valid
    CHECK (decision IN ('HIDE', 'KEEP', 'WARN', 'DISMISS')),
  CONSTRAINT moderation_actions_target_valid
    CHECK (target_kind IN ('REVIEW', 'USER', 'PHOTOGRAPHER')),
  CONSTRAINT moderation_actions_warned_valid CHECK (
    (decision = 'WARN' AND warned_kind IN ('USER', 'PHOTOGRAPHER') AND warned_id IS NOT NULL)
    OR (decision <> 'WARN' AND warned_kind IS NULL AND warned_id IS NULL)
  ),
  CONSTRAINT moderation_actions_hide_is_review
    CHECK (decision <> 'HIDE' OR target_kind = 'REVIEW'),
  CONSTRAINT moderation_actions_note_length CHECK (char_length(note) BETWEEN 1 AND 1000),
  CONSTRAINT moderation_actions_closed_positive CHECK (reports_closed >= 1)
);
CREATE INDEX moderation_actions_target_idx
  ON moderation_actions (target_kind, target_id, created_at);
CREATE INDEX moderation_actions_warned_idx
  ON moderation_actions (warned_kind, warned_id) WHERE decision = 'WARN';

CREATE TRIGGER moderation_actions_append_only
  BEFORE UPDATE OR DELETE ON moderation_actions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER moderation_actions_no_truncate
  BEFORE TRUNCATE ON moderation_actions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ----------------------------------------------------------------------------
-- 5. The application role (migration 0011): append-only tables are
--    SELECT/INSERT only.
-- ----------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON moderation_actions FROM clickco_app;
