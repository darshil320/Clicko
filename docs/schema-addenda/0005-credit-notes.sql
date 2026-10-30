-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0005 · refunds maker–checker + GST credit notes
-- (ADR-0026 D1). Additive only. Same conventions: BIGINT paise, timestamptz,
-- append-only where noted.
-- ============================================================================

-- ── Refunds: the decision and gateway facts the desk needs ──────────────────
-- refund_status already has REQUESTED → APPROVED → PROCESSING → COMPLETED |
-- FAILED, or REJECTED. COMPLETED is ADR-0026's "processed".
ALTER TABLE refunds
  ADD COLUMN rejected_by    uuid REFERENCES staff_users(id),
  ADD COLUMN rejected_at    timestamptz,
  -- the approver's or rejecter's note (a rejection must say why)
  ADD COLUMN decision_note  text,
  ADD COLUMN processing_at  timestamptz,
  -- gateway attempts: the receipt is `<id>` then `<id>.<n>` on a retry
  ADD COLUMN attempts       smallint NOT NULL DEFAULT 0,
  ADD COLUMN failed_at      timestamptz,
  ADD COLUMN failure_reason text,
  -- Four-eyes in the database too: the approver is never the requester.
  ADD CONSTRAINT refund_four_eyes CHECK (
    approved_by IS NULL OR requested_by_id IS NULL OR approved_by <> requested_by_id
  ),
  ADD CONSTRAINT refund_rejection_explained CHECK (
    status <> 'REJECTED' OR (rejected_by IS NOT NULL AND decision_note IS NOT NULL)
  );
-- In-flight refunds per payment (refundable = captured − refunded − in flight).
CREATE INDEX refunds_payment_idx ON refunds (payment_id);


-- ── GST credit notes (CGST Act s.34) ────────────────────────────────────────
-- A refund that reduces an invoiced supply issues one credit note per invoice
-- in its own gapless series per financial year: CN/<FY>/<6-digit seq>
-- (counter: invoice_series row code 'CLK-CN'). It references the original
-- invoice and splits taxable value and CGST + SGST or IGST in the invoice's
-- proportion, to the paisa. Invoices are never edited.
CREATE TABLE credit_notes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_number   text NOT NULL,       -- 'CN/2026-27/000041'
  financial_year       text NOT NULL,       -- '2026-27'
  invoice_id           uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  booking_id           uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  user_id              uuid NOT NULL REFERENCES users(id),
  refund_id            uuid REFERENCES refunds(id) ON DELETE RESTRICT,
  reason_code          text NOT NULL,

  taxable_amount_paise bigint NOT NULL,
  cgst_paise           bigint NOT NULL DEFAULT 0,
  sgst_paise           bigint NOT NULL DEFAULT 0,
  igst_paise           bigint NOT NULL DEFAULT 0,
  total_amount_paise   bigint NOT NULL,
  sac_code             text NOT NULL,
  place_of_supply      text NOT NULL,

  issued_at            timestamptz NOT NULL DEFAULT now(),
  -- s.34(2): issued after 30 Nov following the invoice's FY, it can no
  -- longer reduce output tax (the desk warns before approving).
  late_for_gst         boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT credit_note_amounts CHECK (
    taxable_amount_paise >= 0 AND cgst_paise >= 0 AND sgst_paise >= 0 AND igst_paise >= 0
    AND total_amount_paise > 0
  ),
  CONSTRAINT credit_note_tax_split CHECK (
    (igst_paise > 0 AND cgst_paise = 0 AND sgst_paise = 0) OR (igst_paise = 0)
  ),
  CONSTRAINT credit_note_total CHECK (
    total_amount_paise = taxable_amount_paise + cgst_paise + sgst_paise + igst_paise
  )
);
CREATE UNIQUE INDEX credit_notes_number_uq ON credit_notes (credit_note_number);
CREATE UNIQUE INDEX credit_notes_refund_invoice_uq ON credit_notes (refund_id, invoice_id);
CREATE INDEX credit_notes_invoice_idx ON credit_notes (invoice_id);
CREATE INDEX credit_notes_booking_idx ON credit_notes (booking_id);
-- Issued credit notes are documents: never changed, never deleted.
CREATE TRIGGER credit_notes_append_only
  BEFORE UPDATE OR DELETE ON credit_notes
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- An invoice can never be credited beyond itself, component by component.
CREATE OR REPLACE FUNCTION assert_credit_note_within_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE inv invoices%ROWTYPE; done record;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT coalesce(sum(taxable_amount_paise), 0) AS taxable, coalesce(sum(cgst_paise), 0) AS cgst,
         coalesce(sum(sgst_paise), 0) AS sgst, coalesce(sum(igst_paise), 0) AS igst
    INTO done FROM credit_notes WHERE invoice_id = NEW.invoice_id;
  IF done.taxable + NEW.taxable_amount_paise > inv.taxable_amount_paise
     OR done.cgst + NEW.cgst_paise > inv.cgst_paise
     OR done.sgst + NEW.sgst_paise > inv.sgst_paise
     OR done.igst + NEW.igst_paise > inv.igst_paise THEN
    RAISE EXCEPTION 'Credit notes would exceed invoice %', inv.invoice_number;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER credit_notes_within_invoice
  BEFORE INSERT ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION assert_credit_note_within_invoice();
