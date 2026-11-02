-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0017 · payouts for shoots that never reach delivery
-- (ADR-0027 D5; DOMAIN §2, ADR-0013 D10/D12, ADR-0016 D12). Additive only.
--
--   payouts (§11, unchanged otherwise)
--     + basis      why the photographer is owed:
--                    DELIVERED      the booking was delivered (every row so far)
--                    DATA_LOSS      staff confirmed the files were lost before
--                                   delivery (DOMAIN §2: full payout, capped at
--                                   2 incidents per photographer a year)
--                    ACCESS_DENIED  staff confirmed the venue refused access
--                                   (T&C §7.2: 50 % of the booking charged)
--                    CLIENT_ABSENT  the client did not attend (T&C §3.8: treated
--                                   as completed)
--     + basis_bps  the share of the full payout that basis pays (10000 = all).
--   A data loss past the cap is written WITHHELD with withheld_reason (both in
--   the spec's payouts table): it is never batched, and finance sees why.
--   payouts_data_loss_idx serves the cap's count (photographer, window).
--
-- Grants: only columns are added to an existing mutable table; migration 0011's
-- privileges on payouts already cover them.
-- ============================================================================

ALTER TABLE payouts
  ADD COLUMN basis text NOT NULL DEFAULT 'DELIVERED',
  ADD COLUMN basis_bps integer NOT NULL DEFAULT 10000,
  ADD CONSTRAINT payout_basis_valid
    CHECK (basis IN ('DELIVERED', 'DATA_LOSS', 'ACCESS_DENIED', 'CLIENT_ABSENT')),
  ADD CONSTRAINT payout_basis_bps_range CHECK (basis_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT payout_withheld_has_reason
    CHECK (status <> 'WITHHELD' OR withheld_reason IS NOT NULL);

CREATE INDEX payouts_data_loss_idx ON payouts (photographer_id, eligible_at)
  WHERE basis = 'DATA_LOSS';
