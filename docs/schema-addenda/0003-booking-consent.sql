-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0003 · SA-13 model-release consent per booking
-- DOMAIN Invariant 22 / v0.2 G-40: an opt-in checkbox per booking, never
-- defaulted to true, recorded with a timestamp. Additive only.
-- ============================================================================
ALTER TABLE bookings
  ADD COLUMN model_release_consent    boolean NOT NULL DEFAULT false,
  ADD COLUMN model_release_consent_at timestamptz,
  ADD CONSTRAINT booking_model_release_ts CHECK (
    model_release_consent = false OR model_release_consent_at IS NOT NULL
  );
