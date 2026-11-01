-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0015 · notifications and masked calls (ADR-0027
-- D1–D3). Additive only.
--
--   notification_sends        append-only record of every send attempt
--                             (template, version, channel, masked destination,
--                             status, provider id). One SENT row per
--                             (dedupe_key, channel) — the pipeline's
--                             idempotency backstop. Never a full phone number
--                             or push token, never the message text.
--   device_push_tokens        Expo push tokens of client and Pro app installs.
--   notification_preferences  WhatsApp opt-in and mutes for non-essential
--                             messages (transactional ones always go).
--   call_bindings             a booking's masked-call window: opens at
--                             assignment, closes 2 h after check-out.
--   call_logs                 append-only: who asked for a call, provider id,
--                             status and duration. Never a recording, never a
--                             number. A call is REQUESTED (reserved under a
--                             lock before the provider is asked, so the rate
--                             limit cannot be raced), then INITIATED with the
--                             provider's id or FAILED, then its final status.
--
-- The spec's notification_log (§13) is left unused: it is mutable (status is
-- updated in place) and stores the full recipient address and payload.
-- notification_sends supersedes it for the pipeline.
--
-- The spec's masked_call_log (§13) is left unused too: it has a recording_key
-- (ADR-0027 D3: never a recording), no call window, and a status updated in
-- place. call_bindings + call_logs supersede it.
--
-- Section 6 takes write access to both unused tables away from the app role, so
-- nothing can start filling them by mistake.
--
-- Grants: migration 0011's default privileges give clickco_app full DML on new
-- tables; the two append-only tables have UPDATE/DELETE revoked here and get
-- their own BEFORE TRUNCATE triggers (apps/api/CLAUDE.md "Database roles").
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. notification_sends (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE notification_sends (
  id                   bigserial PRIMARY KEY,
  -- sha256 hex of event id | recipient kind | recipient id | template code
  dedupe_key           char(64) NOT NULL,
  event_id             uuid NOT NULL,
  event_type           text NOT NULL,
  template_code        text NOT NULL,
  template_version     smallint NOT NULL,
  -- null only for a SKIPPED row (nothing to send on: opted out, no channel)
  channel              text,
  recipient_kind       text NOT NULL,
  recipient_id         uuid NOT NULL,
  booking_id           uuid REFERENCES bookings(id),
  -- '******1234' for a phone, 'ExponentPushToken[…wxyz]' for push
  destination_masked   text,
  status               text NOT NULL,
  provider             text,
  provider_message_id  text,
  -- a short machine code from the adapter (e.g. HTTP_429, DEVICE_NOT_REGISTERED)
  error_code           text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_sends_channel_valid
    CHECK (channel IS NULL OR channel IN ('WHATSAPP', 'SMS', 'PUSH')),
  CONSTRAINT notification_sends_recipient_valid
    CHECK (recipient_kind IN ('USER', 'PHOTOGRAPHER', 'SUBJECT')),
  CONSTRAINT notification_sends_status_valid
    CHECK (status IN ('SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT notification_sends_channel_unless_skipped
    CHECK (status = 'SKIPPED' OR channel IS NOT NULL),
  CONSTRAINT notification_sends_error_if_failed
    CHECK (status <> 'FAILED' OR error_code IS NOT NULL)
);
CREATE UNIQUE INDEX notification_sends_once
  ON notification_sends (dedupe_key, channel) WHERE status = 'SENT';
CREATE INDEX notification_sends_dedupe_idx ON notification_sends (dedupe_key);
CREATE INDEX notification_sends_booking_idx
  ON notification_sends (booking_id, created_at) WHERE booking_id IS NOT NULL;
CREATE INDEX notification_sends_failed_idx
  ON notification_sends (created_at) WHERE status = 'FAILED';

CREATE TRIGGER notification_sends_append_only
  BEFORE UPDATE OR DELETE ON notification_sends
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER notification_sends_no_truncate
  BEFORE TRUNCATE ON notification_sends
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ----------------------------------------------------------------------------
-- 2. device_push_tokens
-- ----------------------------------------------------------------------------
CREATE TABLE device_push_tokens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,
  photographer_id  uuid REFERENCES photographers(id) ON DELETE CASCADE,
  expo_token       text NOT NULL,
  platform         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  -- set when Expo reports DeviceNotRegistered, or the token moves to another account
  revoked_at       timestamptz,

  CONSTRAINT device_push_tokens_one_owner
    CHECK ((user_id IS NULL) <> (photographer_id IS NULL)),
  CONSTRAINT device_push_tokens_platform_valid CHECK (platform IN ('ios', 'android')),
  CONSTRAINT device_push_tokens_format
    CHECK (expo_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$')
);
-- an install belongs to one account at a time: re-registering moves it
CREATE UNIQUE INDEX device_push_tokens_token_uq ON device_push_tokens (expo_token);
CREATE INDEX device_push_tokens_user_idx
  ON device_push_tokens (user_id) WHERE user_id IS NOT NULL AND revoked_at IS NULL;
CREATE INDEX device_push_tokens_photographer_idx
  ON device_push_tokens (photographer_id)
  WHERE photographer_id IS NOT NULL AND revoked_at IS NULL;


-- ----------------------------------------------------------------------------
-- 3. notification_preferences (no row = defaults: no WhatsApp opt-in, no mutes)
-- ----------------------------------------------------------------------------
CREATE TABLE notification_preferences (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE CASCADE,
  photographer_id     uuid REFERENCES photographers(id) ON DELETE CASCADE,
  whatsapp_opt_in     boolean NOT NULL DEFAULT false,
  whatsapp_opt_in_at  timestamptz,
  mute_whatsapp       boolean NOT NULL DEFAULT false,
  mute_sms            boolean NOT NULL DEFAULT false,
  mute_push           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_preferences_one_owner
    CHECK ((user_id IS NULL) <> (photographer_id IS NULL)),
  -- an opt-in is evidence: when it was given
  CONSTRAINT notification_preferences_opt_in_ts
    CHECK (whatsapp_opt_in = false OR whatsapp_opt_in_at IS NOT NULL)
);
CREATE UNIQUE INDEX notification_preferences_user_uq
  ON notification_preferences (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX notification_preferences_photographer_uq
  ON notification_preferences (photographer_id) WHERE photographer_id IS NOT NULL;


-- ----------------------------------------------------------------------------
-- 4. call_bindings
-- ----------------------------------------------------------------------------
CREATE TABLE call_bindings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  assignment_id    uuid NOT NULL REFERENCES assignments(id) ON DELETE RESTRICT,
  photographer_id  uuid NOT NULL REFERENCES photographers(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  -- the provider's virtual number (ExoPhone) — Clickco's, not a person's
  virtual_number   text NOT NULL,
  opened_at        timestamptz NOT NULL,
  -- check-out + 2 h; null while the shoot has not checked out
  closes_at        timestamptz,
  -- re-dispatch, cancellation: closed at once
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_bindings_closes_after_open CHECK (closes_at IS NULL OR closes_at > opened_at)
);
CREATE UNIQUE INDEX call_bindings_assignment_uq ON call_bindings (assignment_id);
CREATE INDEX call_bindings_booking_idx ON call_bindings (booking_id, opened_at DESC);


-- ----------------------------------------------------------------------------
-- 5. call_logs (append-only; duration only, never a recording)
-- ----------------------------------------------------------------------------
CREATE TABLE call_logs (
  id                 bigserial PRIMARY KEY,
  -- one masked call: every row of a call shares it
  call_id            uuid NOT NULL,
  binding_id         uuid NOT NULL REFERENCES call_bindings(id),
  booking_id         uuid NOT NULL REFERENCES bookings(id),
  caller_kind        text NOT NULL,
  provider           text NOT NULL,
  provider_call_id   text,
  status             text NOT NULL,
  duration_seconds   integer,
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT call_logs_caller_valid CHECK (caller_kind IN ('USER', 'PHOTOGRAPHER')),
  CONSTRAINT call_logs_status_valid
    CHECK (status IN ('REQUESTED', 'INITIATED', 'FAILED', 'COMPLETED', 'NO_ANSWER', 'BUSY')),
  CONSTRAINT call_logs_duration_valid CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);
CREATE INDEX call_logs_call_idx ON call_logs (call_id);
-- the per-caller rate limits count a binding's recent calls
CREATE INDEX call_logs_binding_idx ON call_logs (binding_id, caller_kind, created_at);
CREATE INDEX call_logs_provider_idx ON call_logs (provider, provider_call_id)
  WHERE provider_call_id IS NOT NULL;
CREATE INDEX call_logs_booking_idx ON call_logs (booking_id, created_at);

CREATE TRIGGER call_logs_append_only
  BEFORE UPDATE OR DELETE ON call_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER call_logs_no_truncate
  BEFORE TRUNCATE ON call_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ----------------------------------------------------------------------------
-- 6. The application role (migration 0011): append-only tables are
--    SELECT/INSERT only; the superseded spec tables are SELECT only.
-- ----------------------------------------------------------------------------
REVOKE UPDATE, DELETE, TRUNCATE ON notification_sends FROM clickco_app;
REVOKE UPDATE, DELETE, TRUNCATE ON call_logs FROM clickco_app;
-- The superseded spec tables: read-only to the app.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON notification_log FROM clickco_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON masked_call_log FROM clickco_app;
