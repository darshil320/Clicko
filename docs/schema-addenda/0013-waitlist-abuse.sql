-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0013 · waitlist abuse limits (security audit Web M3)
-- POST /waitlist is public and unauthenticated. Besides the per-phone daily cap,
-- joins are now rate-limited per pincode and per source network (IPv4 /24,
-- IPv6 /64) per hour and per day (WAITLIST_POLICY in the serviceability module).
-- source_net stores only that network prefix, never the full client address.
--
-- Every entry is unverified: nobody proved they own the number. Clickco never
-- messages an unverified number — a launch notice goes only to an entry whose
-- phone_verified_at is set (an OTP round trip, not built yet). The CHECK below
-- makes the database refuse to mark an unverified entry as notified.
-- Additive only.
-- ============================================================================
ALTER TABLE waitlist_entries
  -- the client's /24 (IPv4) or /64 (IPv6) when the entry was made; null if unknown
  ADD COLUMN source_net cidr,
  -- set only after the person proves the number (OTP); null = unverified
  ADD COLUMN phone_verified_at timestamptz,
  ADD CONSTRAINT waitlist_notify_verified_only CHECK (
    notified_at IS NULL OR phone_verified_at IS NOT NULL
  );

CREATE INDEX waitlist_source_net_idx
  ON waitlist_entries (source_net, created_at) WHERE source_net IS NOT NULL;
CREATE INDEX waitlist_pincode_created_idx ON waitlist_entries (pincode, created_at);
