-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0020 · client account deletion (ADR-0030).
-- Apple App Store guideline 5.1.1(v); DPDP Act 2023 s.12 (erasure). Additive.
--
--   users                 + deleted_at: set once, when the client deletes their
--                           account. The row stays: invoices, payments, credit
--                           notes and ledger entries reference it for the
--                           statutory period (CGST Act s.36: 72 months), so it
--                           is anonymised instead — no phone, name, email,
--                           city, consents or block reason.
--                         phone_e164 becomes nullable, NULL exactly when the
--                           account is deleted, so the same number can sign up
--                           again and gets a fresh account (users_phone_uq
--                           ignores NULLs; findOrCreateByPhone's ON CONFLICT
--                           still infers it).
--                         A deleted row can never change again (trigger): it
--                           cannot be revived or re-linked to a phone.
--   bookings              + client_phone_key: a keyed HMAC of the booking
--                           account's phone (HMAC-SHA256 under OTP_HASH_PEPPER,
--                           label 'promo-phone:'), never the number. Promo
--                           eligibility (first booking, per-person cap) counts
--                           by it as well as by account, so deleting an account
--                           and signing up again with the same number does not
--                           make the next booking a first one. Kept after the
--                           account is deleted, for that purpose only.
--   bookings, device_push_tokens, notification_preferences,
--   client_photographer_blocks
--                         no row is created for (or moved to) a deleted
--                           client (trigger). This closes the race between a
--                           deletion and a request already past the guard: the
--                           trigger takes FOR KEY SHARE on the users row, so it
--                           waits for a deletion in progress and sees its
--                           outcome.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. users: deleted_at, nullable phone, anonymous once deleted
-- ----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_phone_format;

ALTER TABLE users
  ADD CONSTRAINT users_phone_format
    CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  ADD CONSTRAINT users_phone_unless_deleted
    CHECK ((phone_e164 IS NULL) = (deleted_at IS NOT NULL)),
  ADD CONSTRAINT users_deleted_is_anonymous CHECK (
    deleted_at IS NULL OR (
      full_name IS NULL AND email IS NULL AND default_city_id IS NULL
      AND marketing_opt_in = false AND promo_use_consent = false
      AND promo_consent_at IS NULL AND blocked_reason IS NULL
    )
  );

CREATE FUNCTION users_deleted_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'users %: a deleted account cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_deleted_is_final
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_deleted_is_final();


-- ----------------------------------------------------------------------------
-- 2. bookings: the promo key of the account's phone
-- ----------------------------------------------------------------------------
ALTER TABLE bookings
  ADD COLUMN client_phone_key char(64),
  ADD CONSTRAINT bookings_client_phone_key_format
    CHECK (client_phone_key IS NULL OR client_phone_key ~ '^[0-9a-f]{64}$');

CREATE INDEX bookings_client_phone_key_idx ON bookings (client_phone_key)
  WHERE client_phone_key IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 3. No new rows for a deleted client
-- ----------------------------------------------------------------------------
CREATE FUNCTION refuse_deleted_user() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  gone timestamptz;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Locks the row (as the foreign key check would), so a deletion still in
  -- flight is waited for and its committed deleted_at is what is read here.
  SELECT deleted_at INTO gone FROM users WHERE id = NEW.user_id FOR KEY SHARE;
  IF gone IS NOT NULL THEN
    RAISE EXCEPTION '%: user % deleted their account', TG_TABLE_NAME, NEW.user_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bookings_refuse_deleted_user
  BEFORE INSERT OR UPDATE OF user_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION refuse_deleted_user();
CREATE TRIGGER device_push_tokens_refuse_deleted_user
  BEFORE INSERT OR UPDATE OF user_id ON device_push_tokens
  FOR EACH ROW EXECUTE FUNCTION refuse_deleted_user();
CREATE TRIGGER notification_preferences_refuse_deleted_user
  BEFORE INSERT OR UPDATE OF user_id ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION refuse_deleted_user();
CREATE TRIGGER client_photographer_blocks_refuse_deleted_user
  BEFORE INSERT OR UPDATE OF user_id ON client_photographer_blocks
  FOR EACH ROW EXECUTE FUNCTION refuse_deleted_user();
