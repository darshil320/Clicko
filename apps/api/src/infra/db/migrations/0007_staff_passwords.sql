-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0007 · staff password lifecycle (ADR-0026 D7)
-- A temporary password (a new account, or a super admin's reset) stops working
-- 72 hours after it is issued, and the first sign-in with one must choose a new
-- password. Additive only: existing accounts keep their password as it is
-- (must_change_password defaults to false).
-- sessions_valid_after is the staff member's session epoch: a password reset or
-- change, an authenticator reset or a deactivation moves it to "now", and the
-- API refuses any access token issued before it (refresh tokens are revoked as
-- well), so an ended session stops at once rather than within 15 minutes.
-- ============================================================================
ALTER TABLE staff_users
  ADD COLUMN must_change_password     boolean NOT NULL DEFAULT false,
  ADD COLUMN temp_password_expires_at timestamptz,
  ADD COLUMN password_changed_at      timestamptz,
  ADD COLUMN sessions_valid_after     timestamptz;

-- A temporary password always carries its expiry, and only a temporary one does.
ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_temp_password_expiry CHECK (
    must_change_password = (temp_password_expires_at IS NOT NULL)
  );
