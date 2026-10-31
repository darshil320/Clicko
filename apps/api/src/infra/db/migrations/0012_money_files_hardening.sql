-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0012 · money and files hardening (ADR-0027 D6,
-- audit of 31 Oct 2026, "money and files"). Additive only. Grants for the
-- clickco_app role and the TRUNCATE triggers are migration 0011 (identity and
-- access); this file only adds what the money and files fixes need.
-- ============================================================================

-- ── Payment webhooks (audit M3, L1) ─────────────────────────────────────────
-- M3: a webhook with a bad signature is no longer one payment_webhook_events
--   row per attempt (a flood filled the table). It is counted per provider per
--   hour, keeping the first and the latest body hash and size as a sample. No
--   IP address is stored. The API also limits bad signatures per IP in Redis.
-- L1: a verified webhook keeps only the fields Clickco parsed from it (ids,
--   amount, kind) plus the sha256 of the exact body, never the gateway's full
--   payload (payer email, contact and VPA). Payloads already stored are
--   reduced to their event type here.
CREATE TABLE payment_webhook_rejections (
  provider           text        NOT NULL,
  bucket_start       timestamptz NOT NULL,
  rejected_count     integer     NOT NULL CHECK (rejected_count > 0),
  first_body_sha256  text        NOT NULL CHECK (first_body_sha256 ~ '^[0-9a-f]{64}$'),
  last_body_sha256   text        NOT NULL CHECK (last_body_sha256 ~ '^[0-9a-f]{64}$'),
  last_body_bytes    integer     NOT NULL CHECK (last_body_bytes >= 0),
  last_received_at   timestamptz NOT NULL,
  -- the start of a UTC hour, computed by the API (no session time zone involved)
  PRIMARY KEY (provider, bucket_start)
);

ALTER TABLE payment_webhook_events
  ADD COLUMN body_sha256 text CHECK (body_sha256 ~ '^[0-9a-f]{64}$');

UPDATE payment_webhook_events
   SET payload = jsonb_build_object('redacted', true, 'event', event_type)
 WHERE signature_valid;

-- ── Payouts (audit H2, L7) ──────────────────────────────────────────────────
-- H2: a transfer marked failed and sent again pays twice if the first one in
--   fact went through. Each transfer now records who created the bank file it
--   went out in and when (the first file's time survives resends), and a
--   failure records the bank's return reference and who marked it. The API
--   refuses mark-failed / send-again by the person who made the bank file
--   (maker–checker) and raises an ops alert on a resend within 7 days of the
--   original file.
-- L7: a bank UTR identifies one transfer: rows sharing a UTR must be the same
--   transfer (same batch, same photographer). Enforced by two exclusion
--   constraints (btree_gist, 0001), so no UTR is ever reused across payouts.
ALTER TABLE payouts
  ADD COLUMN bank_file_by        uuid REFERENCES staff_users(id),
  ADD COLUMN bank_file_at        timestamptz,
  ADD COLUMN first_bank_file_at  timestamptz,
  ADD COLUMN failure_reference   text,
  ADD COLUMN failed_by           uuid REFERENCES staff_users(id),
  ADD CONSTRAINT payout_failure_reference_format
    CHECK (failure_reference IS NULL OR failure_reference ~ '^[A-Z0-9][A-Z0-9/-]{5,39}$'),
  ADD CONSTRAINT payout_utr_one_batch
    EXCLUDE USING gist (utr WITH =, batch_id WITH <>) WHERE (utr IS NOT NULL),
  ADD CONSTRAINT payout_utr_one_photographer
    EXCLUDE USING gist (utr WITH =, photographer_id WITH <>) WHERE (utr IS NOT NULL);

-- ── Delivery links (audit L2, M5) ───────────────────────────────────────────
-- L2: the public token of a /d/<token> link is no longer stored. The API
--   derives it (HMAC-SHA256 under DELIVERY_LINK_KEY, keyed by the link id)
--   to show it to the booking's owner, and finds a link by the sha256 of the
--   token it is given. A database copy alone opens nothing. Existing rows are
--   backfilled with the hash of their token, then the token is cleared.
-- M5: the provider link stays server-side only (revocation); /d/<token> lists
--   and streams the files through Clickco and never redirects to it.
ALTER TABLE delivery_links
  ADD COLUMN public_token_sha256 text;

UPDATE delivery_links
   SET public_token_sha256 = encode(digest(public_token, 'sha256'), 'hex')
 WHERE public_token IS NOT NULL;

ALTER TABLE delivery_links
  ALTER COLUMN public_token_sha256 SET NOT NULL,
  ALTER COLUMN public_token DROP NOT NULL,
  ADD CONSTRAINT delivery_links_token_sha256_format
    CHECK (public_token_sha256 ~ '^[0-9a-f]{64}$');

UPDATE delivery_links SET public_token = NULL;

ALTER TABLE delivery_links
  ADD CONSTRAINT delivery_links_token_not_stored CHECK (public_token IS NULL);

CREATE UNIQUE INDEX delivery_links_token_sha256_uq ON delivery_links (public_token_sha256);
