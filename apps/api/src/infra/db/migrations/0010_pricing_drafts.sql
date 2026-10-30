-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0010 · pricing drafts (ADR-0026 D4, doc 05 §11)
-- Drafts live in pricing_rulesets with published_at IS NULL (doc 05 §11). The
-- spec gives every row a NOT NULL effective_from and allows only ONE row with
-- effective_to IS NULL (pricing_rulesets_one_current, DOMAIN Invariant 18), so
-- a draft cannot be open-ended. A draft therefore carries a fixed sentinel
-- window — the first microsecond of 1970 — which no clock ever reaches, and
-- loadCurrent prices only published rows anyway. Publishing replaces the
-- window with the real one. Rulesets are never deleted: an unwanted draft is
-- discarded (closed unpublished). Additive only.
-- ============================================================================
ALTER TABLE pricing_rulesets
  ADD COLUMN created_by   uuid REFERENCES staff_users(id),
  -- the published ruleset the draft was copied from (the diff's baseline)
  ADD COLUMN based_on_id  uuid REFERENCES pricing_rulesets(id),
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN discarded_at timestamptz,
  ADD COLUMN discarded_by uuid REFERENCES staff_users(id);

ALTER TABLE pricing_rulesets
  -- an unpublished ruleset never has a real window
  ADD CONSTRAINT pricing_rulesets_draft_window CHECK (
    published_at IS NOT NULL OR (
      effective_from = '1970-01-01 00:00:00+00'::timestamptz
      AND effective_to = '1970-01-01 00:00:00.000001+00'::timestamptz
    )
  ),
  -- only a draft is discarded; a published ruleset is closed by the next publish
  ADD CONSTRAINT pricing_rulesets_discard_draft_only CHECK (
    discarded_at IS NULL OR published_at IS NULL
  ),
  ADD CONSTRAINT pricing_rulesets_discard_by CHECK (
    (discarded_at IS NULL) = (discarded_by IS NULL)
  ),
  ADD CONSTRAINT pricing_rulesets_published_by CHECK (
    published_at IS NOT NULL OR published_by IS NULL
  );

-- The editor's list of open drafts.
CREATE INDEX pricing_rulesets_open_drafts_idx ON pricing_rulesets (created_at DESC)
  WHERE published_at IS NULL AND discarded_at IS NULL;

CREATE TRIGGER pricing_rulesets_touch BEFORE UPDATE ON pricing_rulesets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
