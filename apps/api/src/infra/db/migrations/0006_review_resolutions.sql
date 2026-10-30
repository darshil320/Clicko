-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0006 · settling review items + client credits
-- (ADR-0026 D2). Additive only. Same conventions: BIGINT paise, timestamptz,
-- append-only where noted.
-- ============================================================================

-- A review item is a `*.needs_review` outbox event (REFUND_DUE_*, *_CREDIT_25,
-- ACCESS_DENIED_CHARGE_50, CLIENT_NON_ATTENDANCE, SLA_BREACH_REMEDY, capture
-- anomalies …). Each is settled exactly once, with an outcome and a note.
CREATE TABLE review_resolutions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- domain_events.event_id of the review (no FK: the outbox may be archived)
  review_event_id  uuid NOT NULL,
  review_type      text NOT NULL,         -- 'booking.needs_review' | 'payment.needs_review'
  reason           text NOT NULL,
  booking_id       uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  -- REFUND_REQUESTED | CREDIT_ISSUED | CHARGE_RAISED | NO_ACTION
  outcome          text NOT NULL,
  amount_paise     bigint,
  -- the credit issued (CREDIT_ISSUED, or the apology credit with a refund)
  credit_id        uuid REFERENCES client_credits(id),
  -- the SLA breach whose remedy this settled (SLA_BREACH_REMEDY)
  breach_id        uuid REFERENCES sla_breaches(id),
  note             text NOT NULL,
  resolved_by      uuid NOT NULL REFERENCES staff_users(id),
  resolved_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_resolution_outcome_valid CHECK (
    outcome IN ('REFUND_REQUESTED', 'CREDIT_ISSUED', 'CHARGE_RAISED', 'NO_ACTION')
  ),
  CONSTRAINT review_resolution_amount CHECK (
    (outcome = 'NO_ACTION' AND amount_paise IS NULL)
    OR (outcome <> 'NO_ACTION' AND amount_paise > 0)
  ),
  CONSTRAINT review_resolution_credit CHECK (outcome <> 'CREDIT_ISSUED' OR credit_id IS NOT NULL)
);
-- Settled exactly once.
CREATE UNIQUE INDEX review_resolutions_event_uq ON review_resolutions (review_event_id);
CREATE INDEX review_resolutions_booking_idx ON review_resolutions (booking_id);
CREATE TRIGGER review_resolutions_append_only
  BEFORE UPDATE OR DELETE ON review_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A refund requested by settling a review points back at that settlement.
ALTER TABLE refunds
  ADD COLUMN review_resolution_id uuid REFERENCES review_resolutions(id);

-- ── Client credits: a reason note, and no withdrawal ────────────────────────
-- Valid 12 months (expires_at), issued by the QM or finance with a reason.
ALTER TABLE client_credits
  ADD COLUMN reason_note text;

-- An issued credit cannot be withdrawn or rewritten: only consumed_paise (S11
-- redemption) may change. (Deletion only happens through the user cascade.)
CREATE OR REPLACE FUNCTION forbid_credit_rewrite() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_paise <> OLD.amount_paise
     OR NEW.user_id <> OLD.user_id
     OR NEW.reason_code <> OLD.reason_code
     OR NEW.reason_note IS DISTINCT FROM OLD.reason_note
     OR NEW.source_booking_id IS DISTINCT FROM OLD.source_booking_id
     OR NEW.issued_by IS DISTINCT FROM OLD.issued_by
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'An issued client credit cannot be changed or withdrawn';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER client_credits_terms_fixed
  BEFORE UPDATE ON client_credits
  FOR EACH ROW EXECUTE FUNCTION forbid_credit_rewrite();
