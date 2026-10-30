-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0009 · payouts: deductions, TDS base, one draft
-- (ADR-0026 D3, stream B). Additive only.
--
-- payout_deductions: each late-delivery deduction (sla_breaches, attributed to
--   the photographer and applied) and each un-waived penalty with a payout
--   deduction (photographer_penalties) is recognised on exactly one payout —
--   the unique (source_kind, source_id) index is that guarantee. What a payout
--   cannot absorb is carried forward (the ledger's VENDOR_RECOVERABLE balance);
--   the row keeps the amount and the booking it came from for the statement.
--   Rows of a draft batch are removed if the draft is discarded.
-- payouts.tds_base_paise: the amount a payout's TDS covers. On the payout that
--   takes the year's total past the s.194C limit it is the year's whole untaxed
--   amount, so later payouts never tax the same rupee twice.
-- payout_batches: at most one draft (status PENDING) at a time, so two drafts
--   can never assess the same photographer's year to date differently.
-- ============================================================================
ALTER TABLE payouts
  ADD COLUMN tds_base_paise bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT payout_tds_base_nonneg CHECK (tds_base_paise >= 0);

CREATE INDEX payouts_batch_idx ON payouts (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE payout_deductions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the payout it was recognised on (taken off it, or carried forward from it)
  payout_id        uuid NOT NULL REFERENCES payouts(id) ON DELETE RESTRICT,
  photographer_id  uuid NOT NULL REFERENCES photographers(id) ON DELETE RESTRICT,
  -- the booking the deduction belongs to
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  source_kind      text NOT NULL,          -- SLA_BREACH | PENALTY
  source_id        uuid NOT NULL,          -- sla_breaches.id | photographer_penalties.id
  basis_paise      bigint NOT NULL,        -- the booking's payout the rate is taken from
  rate_bps         integer NOT NULL,
  amount_paise     bigint NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_deduction_source CHECK (source_kind IN ('SLA_BREACH', 'PENALTY')),
  CONSTRAINT payout_deduction_amounts CHECK (
    basis_paise >= 0 AND amount_paise >= 0 AND rate_bps BETWEEN 0 AND 10000
  )
);
CREATE UNIQUE INDEX payout_deductions_source_uq ON payout_deductions (source_kind, source_id);
CREATE INDEX payout_deductions_payout_idx ON payout_deductions (payout_id);
CREATE INDEX payout_deductions_pro_idx ON payout_deductions (photographer_id);

CREATE UNIQUE INDEX payout_batches_one_draft_uq ON payout_batches ((true))
  WHERE status = 'PENDING';
