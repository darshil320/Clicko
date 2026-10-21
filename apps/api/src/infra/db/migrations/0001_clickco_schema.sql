-- ============================================================================
-- CLICKCO — PRODUCTION POSTGRES SCHEMA
-- Doc 4 of N · 27 Aug 2026
-- Postgres 16+ · PostGIS · btree_gist
--
-- READ FIRST
-- ----------
-- 1. This SQL is the SOURCE OF TRUTH for the schema, not an ORM schema file.
--    Exclusion constraints, immutability triggers, partial indexes, deferred
--    constraint triggers and PostGIS types are not expressible in Prisma's
--    schema language. See the note at the bottom of this file — I'm revising
--    the earlier Prisma recommendation.
--
-- 2. MONEY IS ALWAYS BIGINT PAISE. ₹8,500.00 is 850000. There is no DECIMAL
--    and no NUMERIC anywhere near money in this schema. Percentages are basis
--    points (INTEGER bps): 18% is 1800, 62.5% is 6250.
--
-- 3. Photographer verification is MANUAL. No eKYC integration, no DigiLocker,
--    no Aadhaar API. Documents are uploaded, a human reviews, the decision is
--    recorded with an audit trail.
--
-- 4. AADHAAR: do not store the number. `id_proof_kind` deliberately omits it
--    as a *retained* document type. Identity is confirmed at interview and
--    recorded as a boolean plus last-4. Private-entity Aadhaar retention
--    carries legal restrictions you do not need to take on.
--
-- 5. Append-only tables (ledger_entries, audit_logs, booking_status_events,
--    domain_events) are enforced by trigger AND by GRANT. See §12.
-- ============================================================================


-- ============================================================================
-- §0  EXTENSIONS, ROLES, HELPERS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS postgis;     -- geography(Point)
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusion constraints
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fuzzy name search in admin

-- Application role. Deliberately NOT the owner. See §12 for grants.
-- CREATE ROLE clickco_app LOGIN PASSWORD '...';

CREATE OR REPLACE FUNCTION clickco_add_minutes(ts timestamptz, mins integer)
RETURNS timestamptz LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT ts + mins * interval '1 minute'
$$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Table %.% is append-only; % is not permitted',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP;
END $$;

CREATE OR REPLACE FUNCTION forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Row in %.% is immutable once written', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;


-- ============================================================================
-- §1  ENUMS
-- ============================================================================

CREATE TYPE plan_tier AS ENUM (
  'BASIC', 'SEMI_PRO', 'PROFESSIONAL', 'EXPERT', 'SIGNATURE'
);

CREATE TYPE city_tier AS ENUM ('METRO', 'TIER_1', 'TIER_2', 'TIER_3');

CREATE TYPE area_status AS ENUM ('LIVE', 'PILOT', 'WAITLIST', 'BLOCKED');

-- The full booking lifecycle. Transitions are validated in the application
-- layer against docs/DOMAIN.md and logged to booking_status_events.
CREATE TYPE booking_status AS ENUM (
  'DRAFT',
  'QUOTED',
  'ADVANCE_PENDING',
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'CHECKED_IN',
  'IN_PROGRESS',
  'CHECKED_OUT',
  'UPLOADING',
  'PROCESSING',
  'QA',
  'BALANCE_PENDING',
  'DELIVERED',
  'CLOSED',
  -- terminal / exception
  'CANCELLED_CLIENT',
  'CANCELLED_PRO',
  'PRO_NO_SHOW',
  'ACCESS_DENIED',
  'UNSAFE_SITE',
  'DATA_LOSS',
  'QUALITY_ESCALATION',
  'ABANDONED'
);

CREATE TYPE emergency_band AS ENUM (
  'NONE',            -- > 48h lead time
  'NEXT_DAY',        -- 24-48h
  'SAME_DAY',        -- 8-24h
  'HOURS_3_8',       -- 3-8h
  'HOURS_UNDER_3'    -- < 3h, best-effort only
);

CREATE TYPE photographer_status AS ENUM (
  'APPLICANT', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'OFFBOARDED'
);

-- Manual onboarding pipeline. This IS the kanban in the admin panel.
CREATE TYPE application_stage AS ENUM (
  'APPLIED',
  'SCREENING',              -- ops reviews portfolio link
  'INTERVIEW_SCHEDULED',
  'INTERVIEW_DONE',
  'DOCS_REQUESTED',
  'DOCS_UNDER_REVIEW',
  'TRIAL_ASSIGNED',
  'TRIAL_REVIEW',
  'CONTRACT_SENT',
  'APPROVED',
  'REJECTED',
  'ON_HOLD',
  'WITHDRAWN'
);

-- NOTE: no AADHAAR entry. See header note 4.
CREATE TYPE document_kind AS ENUM (
  'PAN_CARD',
  'DRIVING_LICENCE',
  'PASSPORT',
  'VOTER_ID',
  'ADDRESS_PROOF',
  'POLICE_VERIFICATION',
  'BANK_PROOF',
  'GST_CERTIFICATE',
  'DRONE_RPC',              -- DGCA Remote Pilot Certificate
  'DRONE_UIN',              -- drone registration
  'EQUIPMENT_INVOICE',
  'SIGNED_CONTRACT',
  'OTHER'
);

CREATE TYPE document_review_status AS ENUM (
  'PENDING', 'APPROVED', 'REJECTED', 'RESUBMIT_REQUESTED', 'EXPIRED'
);

CREATE TYPE assignment_status AS ENUM (
  'ASSIGNED', 'EN_ROUTE', 'ACTIVE', 'COMPLETED', 'ABANDONED', 'RELEASED'
);

CREATE TYPE dispatch_outcome AS ENUM (
  'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'LOST_RACE'
);

CREATE TYPE asset_kind AS ENUM (
  'RAW_PHOTO', 'JPEG_PHOTO', 'VIDEO', 'PROOF_SHOT'
);

CREATE TYPE upload_session_status AS ENUM (
  'OPEN', 'UPLOADING', 'VERIFYING', 'COMPLETED', 'FAILED', 'ABORTED'
);

CREATE TYPE payment_purpose AS ENUM (
  'ADVANCE', 'BALANCE', 'FULL', 'EXTENSION', 'EDIT_SERVICE'
);

CREATE TYPE payment_status AS ENUM (
  'CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED',
  'REFUNDED', 'PARTIALLY_REFUNDED', 'AUTH_RELEASED'
);

CREATE TYPE refund_status AS ENUM (
  'REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'
);

CREATE TYPE payout_status AS ENUM (
  'PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'WITHHELD', 'REVERSED'
);

CREATE TYPE ledger_direction AS ENUM ('DEBIT', 'CREDIT');

CREATE TYPE sla_kind AS ENUM (
  'UPLOAD_START',          -- T0 + 2h
  'UPLOAD_COMPLETE',       -- T0 + 12h
  'PROCESSING_COMPLETE',   -- T0 + 18h
  'QA_COMPLETE',           -- T0 + 24h
  'DELIVERY_DUE',          -- T0 + 48h  ← the promise
  'DELIVERY_RED_ALERT',    -- T0 + 44h
  'BALANCE_REMINDER',      -- delivery ready + 24h / 72h / 7d
  'BOOKING_ABANDON',       -- balance unpaid + 30d
  'RAW_PURGE',             -- delivered + 7d
  'JPEG_PURGE',            -- delivered + 30d
  'LINK_REVOKE'            -- delivered + 30d
);

CREATE TYPE sla_clock_state AS ENUM (
  'ARMED', 'MET', 'BREACHED', 'CANCELLED'
);

CREATE TYPE staff_role AS ENUM (
  'SUPER_ADMIN', 'FINANCE', 'CITY_MANAGER', 'OPS_AGENT',
  'QUALITY_MANAGER', 'SUPPORT', 'READ_ONLY'
);


-- ============================================================================
-- §2  IDENTITY & ACCESS
-- ============================================================================

CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text NOT NULL,
  full_name          text,
  email              text,
  -- G-08: a booker may not be the subject of the shoot
  default_city_id    uuid,
  locale             text NOT NULL DEFAULT 'en-IN',
  marketing_opt_in   boolean NOT NULL DEFAULT false,
  -- §9.4 T&C: promotional use of their photos is OPT-IN, not opt-out
  promo_use_consent  boolean NOT NULL DEFAULT false,
  promo_consent_at   timestamptz,
  is_blocked         boolean NOT NULL DEFAULT false,
  blocked_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_phone_format CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  CONSTRAINT users_promo_consent_ts CHECK (
    (promo_use_consent = false) OR (promo_consent_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX users_phone_uq ON users (phone_e164);
CREATE INDEX users_email_idx ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  full_name     text NOT NULL,
  phone_e164    text,
  password_hash text NOT NULL,
  totp_secret   text,                    -- 2FA mandatory for FINANCE+
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX staff_users_email_uq ON staff_users (lower(email));
CREATE TRIGGER staff_users_touch BEFORE UPDATE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE staff_role_grants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id   uuid NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
  role       staff_role NOT NULL,
  -- NULL city_id = all cities. CITY_MANAGER must be scoped.
  city_id    uuid,
  granted_by uuid REFERENCES staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT city_manager_must_be_scoped CHECK (
    role <> 'CITY_MANAGER' OR city_id IS NOT NULL
  )
);
CREATE UNIQUE INDEX staff_role_grants_uq
  ON staff_role_grants (staff_id, role, coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid));


CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL,
  code_hash     text NOT NULL,           -- never store the plaintext OTP
  purpose       text NOT NULL,           -- LOGIN | PRO_LOGIN | PHONE_CHANGE
  attempts      smallint NOT NULL DEFAULT 0,
  max_attempts  smallint NOT NULL DEFAULT 5,
  consumed_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  created_ip    inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_active_idx ON otp_challenges (phone_e164, purpose)
  WHERE consumed_at IS NULL;


CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_kind text NOT NULL,            -- USER | PHOTOGRAPHER | STAFF
  subject_id   uuid NOT NULL,
  token_hash   text NOT NULL,
  device_id    text,
  user_agent   text,
  revoked_at   timestamptz,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_subject_idx ON refresh_tokens (subject_kind, subject_id)
  WHERE revoked_at IS NULL;


-- ============================================================================
-- §3  GEOGRAPHY & SERVICEABILITY
-- ============================================================================

CREATE TABLE cities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  state         text NOT NULL,
  tier          city_tier NOT NULL,
  centre        geography(Point, 4326) NOT NULL,
  status        area_status NOT NULL DEFAULT 'WAITLIST',
  timezone      text NOT NULL DEFAULT 'Asia/Kolkata',
  launched_at   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cities_name_state_uq ON cities (lower(name), lower(state));
CREATE INDEX cities_centre_gix ON cities USING gist (centre);
CREATE INDEX cities_status_idx ON cities (status);
CREATE TRIGGER cities_touch BEFORE UPDATE ON cities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE users
  ADD CONSTRAINT users_city_fk
  FOREIGN KEY (default_city_id) REFERENCES cities(id);

ALTER TABLE staff_role_grants
  ADD CONSTRAINT staff_role_grants_city_fk
  FOREIGN KEY (city_id) REFERENCES cities(id);


-- G-22: pincode gating + waitlist. This table decides whether a booking can
-- even be created.
CREATE TABLE serviceable_areas (
  pincode        char(6) PRIMARY KEY,
  city_id        uuid NOT NULL REFERENCES cities(id),
  area_name      text,
  status         area_status NOT NULL DEFAULT 'WAITLIST',
  travel_zone    smallint NOT NULL DEFAULT 0,   -- 0: <=15km, 1: 15-40km, 2: outstation
  centroid       geography(Point, 4326),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pincode_format CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  CONSTRAINT travel_zone_range CHECK (travel_zone BETWEEN 0 AND 2)
);
CREATE INDEX serviceable_areas_city_idx ON serviceable_areas (city_id, status);
CREATE INDEX serviceable_areas_centroid_gix ON serviceable_areas USING gist (centroid);
CREATE TRIGGER serviceable_areas_touch BEFORE UPDATE ON serviceable_areas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE waitlist_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164     text NOT NULL,
  full_name      text,
  pincode        char(6) NOT NULL,
  city_name_raw  text,                   -- what they typed, may not match a city
  city_id        uuid REFERENCES cities(id),
  category_id    uuid,
  intended_date  date,
  intended_tier  plan_tier,
  -- lets ops rank expansion by demand value, not guesswork
  estimated_value_paise bigint,
  notified_at    timestamptz,
  converted_booking_id  uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waitlist_pincode_idx ON waitlist_entries (pincode);
CREATE INDEX waitlist_city_idx ON waitlist_entries (city_id) WHERE notified_at IS NULL;
CREATE UNIQUE INDEX waitlist_dedupe_uq
  ON waitlist_entries (phone_e164, pincode, coalesce(intended_date, '1900-01-01'));


-- ============================================================================
-- §4  CATALOGUE
-- ============================================================================

CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,            -- FOOD, WEDDING, PORTRAIT, PRODUCT, EVENT, REAL_ESTATE, CORPORATE
  name         text NOT NULL,
  description  text,
  -- certification required at these tiers or above (NULL = never required)
  cert_required_from plan_tier,
  sort_order   smallint NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  hero_asset_key text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX categories_code_uq ON categories (code);
CREATE TRIGGER categories_touch BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE waitlist_entries
  ADD CONSTRAINT waitlist_category_fk
  FOREIGN KEY (category_id) REFERENCES categories(id);


-- What each tier actually promises. Referenced by the app, the T&C and the
-- quality escalation process. Versioned by ruleset so historical bookings
-- resolve to what was promised at the time.
CREATE TABLE plan_deliverables (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id             uuid NOT NULL,
  tier                   plan_tier NOT NULL,
  frames_per_hour        smallint NOT NULL,
  gear_class             text NOT NULL,          -- 'APS-C, 1 lens' etc
  dual_card_required     boolean NOT NULL DEFAULT false,
  second_shooter_included boolean NOT NULL DEFAULT false,
  raw_included           boolean NOT NULL DEFAULT true,
  jpeg_included          boolean NOT NULL DEFAULT true,
  video_included         boolean NOT NULL DEFAULT false,
  edit_included          boolean NOT NULL DEFAULT false,   -- always false in v1
  delivery_hours         smallint NOT NULL DEFAULT 48,
  min_hours              numeric(4,1) NOT NULL DEFAULT 2.0,
  is_instant_bookable    boolean NOT NULL DEFAULT true,    -- SIGNATURE = false
  created_at             timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE addons (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL,      -- SECOND_SHOOTER, DRONE, LIGHTING_KIT, RUSH_24H
  name        text NOT NULL,
  description text,
  -- G-05: drone requires DGCA credentials on the photographer AND an
  -- airspace check on the venue
  requires_drone_credentials boolean NOT NULL DEFAULT false,
  requires_airspace_check    boolean NOT NULL DEFAULT false,
  min_tier    plan_tier,          -- NULL = available at all tiers
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX addons_code_uq ON addons (code);


-- ============================================================================
-- §5  PRICING  (see Doc 5 for the resolution algorithm)
-- ============================================================================

-- Everything price-related hangs off a versioned, effective-dated ruleset.
-- A booking snapshots the ruleset_id it priced against and NEVER reprices.
CREATE TABLE pricing_rulesets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version         text NOT NULL,            -- '2026.09.01'
  label           text,
  effective_from  timestamptz NOT NULL,
  effective_to    timestamptz,              -- NULL = current
  prices_include_gst boolean NOT NULL,      -- ← OPEN DECISION, see Doc 5 §6
  gst_rate_bps    integer NOT NULL DEFAULT 1800,
  sac_code        text NOT NULL DEFAULT '998383',
  published_at    timestamptz,
  published_by    uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ruleset_window CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT gst_rate_sane CHECK (gst_rate_bps BETWEEN 0 AND 5000)
);
CREATE UNIQUE INDEX pricing_rulesets_version_uq ON pricing_rulesets (version);
-- only one ruleset may be open-ended at a time
CREATE UNIQUE INDEX pricing_rulesets_one_current
  ON pricing_rulesets ((effective_to IS NULL)) WHERE effective_to IS NULL;

ALTER TABLE plan_deliverables
  ADD CONSTRAINT plan_deliverables_ruleset_fk
  FOREIGN KEY (ruleset_id) REFERENCES pricing_rulesets(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX plan_deliverables_uq ON plan_deliverables (ruleset_id, tier);


-- 5 tiers × 4 city tiers = 20 rows. Explicit, readable, admin-editable.
CREATE TABLE base_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id          uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  tier                plan_tier NOT NULL,
  city_tier           city_tier NOT NULL,
  rate_per_hour_paise bigint NOT NULL,
  -- what the photographer receives, as a share of pre-GST service revenue
  payout_share_bps    integer NOT NULL DEFAULT 6000,
  is_quote_only       boolean NOT NULL DEFAULT false,   -- SIGNATURE
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT base_rate_positive CHECK (rate_per_hour_paise >= 0),
  CONSTRAINT payout_share_range CHECK (payout_share_bps BETWEEN 0 AND 10000)
);
CREATE UNIQUE INDEX base_rates_uq ON base_rates (ruleset_id, tier, city_tier);


-- ~8 rows. Wedding costs more than portrait at the same tier.
CREATE TABLE category_uplifts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id     uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES categories(id),
  tier           plan_tier,          -- NULL = applies to all tiers
  multiplier_bps integer NOT NULL DEFAULT 10000,   -- 10000 = 1.00×
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uplift_range CHECK (multiplier_bps BETWEEN 5000 AND 30000)
);
CREATE UNIQUE INDEX category_uplifts_uq
  ON category_uplifts (ruleset_id, category_id,
                       coalesce(tier, 'BASIC'::plan_tier));


CREATE TABLE emergency_multipliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id     uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  band           emergency_band NOT NULL,
  multiplier_bps integer NOT NULL,
  -- HOURS_UNDER_3 is authorise-only: we do not capture until a pro accepts
  capture_on_accept_only boolean NOT NULL DEFAULT false,
  is_guaranteed  boolean NOT NULL DEFAULT true,
  auto_refund_minutes_before smallint,     -- 90 for HOURS_UNDER_3
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT emergency_multiplier_range CHECK (multiplier_bps BETWEEN 10000 AND 40000)
);
CREATE UNIQUE INDEX emergency_multipliers_uq ON emergency_multipliers (ruleset_id, band);


CREATE TABLE time_multipliers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id     uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  kind           text NOT NULL,            -- NIGHT | WEEKEND
  -- for NIGHT: local time window. inclusive start, exclusive end.
  window_start   time,
  window_end     time,
  -- for WEEKEND: ISO day numbers, 6=Sat 7=Sun
  iso_dow        smallint[],
  multiplier_bps integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT time_multiplier_range CHECK (multiplier_bps BETWEEN 10000 AND 25000)
);


-- G-29: seeded 24 months out. Drives surge without ops touching prices.
CREATE TABLE festival_calendar (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id     uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  label          text NOT NULL,            -- 'Diwali 2026', 'Wedding season'
  date_from      date NOT NULL,
  date_to        date NOT NULL,
  city_id        uuid REFERENCES cities(id),   -- NULL = all cities
  multiplier_bps integer NOT NULL,
  -- T&C §3.2: peak season forfeits 50% of advance inside 7 days
  is_peak_season boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT festival_window CHECK (date_to >= date_from),
  CONSTRAINT festival_multiplier_range CHECK (multiplier_bps BETWEEN 10000 AND 25000)
);
CREATE INDEX festival_lookup_idx ON festival_calendar (ruleset_id, date_from, date_to);


CREATE TABLE travel_slabs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id      uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  city_tier       city_tier NOT NULL,
  zone            smallint NOT NULL,
  from_km         numeric(6,2) NOT NULL,
  to_km           numeric(6,2),            -- NULL = unbounded (outstation)
  flat_paise      bigint NOT NULL DEFAULT 0,
  per_km_paise    bigint NOT NULL DEFAULT 0,
  overnight_paise bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT travel_slab_window CHECK (to_km IS NULL OR to_km > from_km),
  CONSTRAINT travel_amounts_positive CHECK (
    flat_paise >= 0 AND per_km_paise >= 0 AND overnight_paise >= 0
  )
);
CREATE UNIQUE INDEX travel_slabs_uq ON travel_slabs (ruleset_id, city_tier, zone);


CREATE TABLE addon_prices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id    uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  addon_id      uuid NOT NULL REFERENCES addons(id),
  tier          plan_tier,                 -- NULL = same price at all tiers
  city_tier     city_tier,                 -- NULL = same price everywhere
  amount_paise  bigint NOT NULL,
  -- per booking, or multiplied by hours?
  is_per_hour   boolean NOT NULL DEFAULT false,
  payout_share_bps integer NOT NULL DEFAULT 6000,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT addon_amount_positive CHECK (amount_paise >= 0)
);
CREATE UNIQUE INDEX addon_prices_uq
  ON addon_prices (ruleset_id, addon_id,
                   coalesce(tier, 'BASIC'::plan_tier),
                   coalesce(city_tier, 'METRO'::city_tier));


CREATE TABLE extension_rates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleset_id          uuid NOT NULL REFERENCES pricing_rulesets(id) ON DELETE CASCADE,
  tier                plan_tier NOT NULL,
  city_tier           city_tier NOT NULL,
  hourly_paise        bigint NOT NULL,
  -- T&C §2.6: 15 minute grace, then chargeable
  waiting_grace_minutes smallint NOT NULL DEFAULT 15,
  waiting_hourly_paise  bigint NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT extension_positive CHECK (hourly_paise >= 0 AND waiting_hourly_paise >= 0)
);
CREATE UNIQUE INDEX extension_rates_uq ON extension_rates (ruleset_id, tier, city_tier);


CREATE TABLE promo_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL,
  description        text,
  discount_bps       integer,              -- percentage off
  discount_flat_paise bigint,              -- or flat amount
  max_discount_paise bigint,
  min_booking_paise  bigint NOT NULL DEFAULT 0,
  applies_to_tiers   plan_tier[],
  applies_to_cities  uuid[],
  first_booking_only boolean NOT NULL DEFAULT false,
  total_redemption_cap integer,
  per_user_cap       smallint NOT NULL DEFAULT 1,
  valid_from         timestamptz NOT NULL,
  valid_to           timestamptz NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES staff_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT promo_one_discount_kind CHECK (
    (discount_bps IS NOT NULL) <> (discount_flat_paise IS NOT NULL)
  ),
  CONSTRAINT promo_window CHECK (valid_to > valid_from)
);
CREATE UNIQUE INDEX promo_codes_code_uq ON promo_codes (upper(code));


-- ============================================================================
-- §6  PHOTOGRAPHERS  (manual onboarding — no eKYC)
-- ============================================================================

CREATE TABLE photographers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text NOT NULL,
  full_name          text NOT NULL,
  email              text,
  city_id            uuid NOT NULL REFERENCES cities(id),
  base_pincode       char(6),
  base_location      geography(Point, 4326),
  status             photographer_status NOT NULL DEFAULT 'APPLICANT',

  -- highest tier they may be dispatched at
  max_tier           plan_tier NOT NULL DEFAULT 'BASIC',
  service_radius_km  numeric(5,1) NOT NULL DEFAULT 15.0,
  accepts_emergency  boolean NOT NULL DEFAULT false,
  accepts_outstation boolean NOT NULL DEFAULT false,

  -- MANUAL verification. A human ticked these.
  identity_confirmed_at       timestamptz,
  identity_confirmed_by       uuid REFERENCES staff_users(id),
  -- store ONLY last 4 of whichever ID was shown. Never the full number.
  id_proof_kind               document_kind,
  id_proof_last4              char(4),
  police_verification_at      date,
  police_verification_expires date,
  pan_verified_at             timestamptz,
  bank_verified_at            timestamptz,

  -- tax
  pan_number         text,               -- required for TDS
  gstin              text,               -- NULL = unregistered vendor, no ITC
  is_gst_registered  boolean NOT NULL DEFAULT false,

  -- per-photographer override of base_rates.payout_share_bps
  payout_share_override_bps integer,

  onboarded_at       timestamptz,
  suspended_at       timestamptz,
  suspension_reason  text,
  offboarded_at      timestamptz,
  internal_notes     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pro_phone_format CHECK (phone_e164 ~ '^\+91[6-9][0-9]{9}$'),
  CONSTRAINT pro_pan_format CHECK (pan_number IS NULL OR pan_number ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT pro_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{1}Z[A-Z0-9]{1}$'),
  CONSTRAINT pro_gst_consistency CHECK (is_gst_registered = false OR gstin IS NOT NULL),
  CONSTRAINT pro_payout_override_range CHECK (
    payout_share_override_bps IS NULL OR payout_share_override_bps BETWEEN 0 AND 10000
  ),
  -- an ACTIVE photographer must have passed manual verification
  CONSTRAINT pro_active_requires_verification CHECK (
    status <> 'ACTIVE' OR (
      identity_confirmed_at IS NOT NULL
      AND police_verification_at IS NOT NULL
      AND pan_verified_at IS NOT NULL
      AND bank_verified_at IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX photographers_phone_uq ON photographers (phone_e164);
CREATE INDEX photographers_city_status_idx ON photographers (city_id, status);
CREATE INDEX photographers_location_gix ON photographers USING gist (base_location);
CREATE INDEX photographers_name_trgm ON photographers USING gin (full_name gin_trgm_ops);
-- the dispatch hot path
CREATE INDEX photographers_dispatchable_idx ON photographers (city_id, max_tier)
  WHERE status = 'ACTIVE';
CREATE TRIGGER photographers_touch BEFORE UPDATE ON photographers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- The onboarding kanban in the admin panel.
CREATE TABLE photographer_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id     uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  stage               application_stage NOT NULL DEFAULT 'APPLIED',
  source              text,               -- REFERRAL | INSTAGRAM | WALK_IN | OUTREACH
  portfolio_url       text,
  years_experience    smallint,
  declared_gear       text,
  requested_categories uuid[],
  requested_max_tier  plan_tier,

  assigned_reviewer_id uuid REFERENCES staff_users(id),
  interview_at        timestamptz,
  interview_mode      text,               -- IN_PERSON | VIDEO | PHONE
  interview_notes     text,
  interview_score     smallint,           -- 1-10
  interview_by        uuid REFERENCES staff_users(id),

  trial_booking_id    uuid,
  trial_score         smallint,
  trial_notes         text,

  decision            text,               -- APPROVED | REJECTED
  decision_reason     text,
  decided_by          uuid REFERENCES staff_users(id),
  decided_at          timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT interview_score_range CHECK (interview_score IS NULL OR interview_score BETWEEN 1 AND 10),
  CONSTRAINT trial_score_range CHECK (trial_score IS NULL OR trial_score BETWEEN 1 AND 10)
);
CREATE INDEX pro_applications_stage_idx ON photographer_applications (stage, created_at);
CREATE INDEX pro_applications_reviewer_idx ON photographer_applications (assigned_reviewer_id)
  WHERE stage NOT IN ('APPROVED','REJECTED','WITHDRAWN');
CREATE TRIGGER pro_applications_touch BEFORE UPDATE ON photographer_applications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE photographer_application_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES photographer_applications(id) ON DELETE CASCADE,
  from_stage     application_stage,
  to_stage       application_stage NOT NULL,
  actor_staff_id uuid REFERENCES staff_users(id),
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pro_app_events_idx ON photographer_application_events (application_id, created_at);
CREATE TRIGGER pro_app_events_append_only
  BEFORE UPDATE OR DELETE ON photographer_application_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- Uploaded documents + the human review decision.
CREATE TABLE photographer_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id  uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  kind             document_kind NOT NULL,
  storage_key      text NOT NULL,        -- via StoragePort, private bucket/folder
  original_filename text,
  mime_type        text,
  size_bytes       bigint,
  -- last 4 only, and only where a number is genuinely needed
  reference_last4  char(4),
  issued_on        date,
  expires_on       date,

  review_status    document_review_status NOT NULL DEFAULT 'PENDING',
  reviewed_by      uuid REFERENCES staff_users(id),
  reviewed_at      timestamptz,
  review_note      text,

  -- DPDP: sensitive personal data. Purge when the relationship ends.
  purge_after      date,
  purged_at        timestamptz,

  uploaded_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT doc_reviewed_consistency CHECK (
    review_status = 'PENDING' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX pro_docs_pro_idx ON photographer_documents (photographer_id, kind);
CREATE INDEX pro_docs_review_queue_idx ON photographer_documents (uploaded_at)
  WHERE review_status = 'PENDING';
-- expiry watchlist: police verification, drone RPC, insurance
CREATE INDEX pro_docs_expiring_idx ON photographer_documents (expires_on)
  WHERE expires_on IS NOT NULL AND purged_at IS NULL;


CREATE TABLE photographer_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  category_id     uuid NOT NULL REFERENCES categories(id),
  -- certified up to this tier for this category
  certified_tier  plan_tier NOT NULL,
  certified_by    uuid REFERENCES staff_users(id),
  certified_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoke_reason   text,
  portfolio_note  text
);
CREATE UNIQUE INDEX pro_categories_uq
  ON photographer_categories (photographer_id, category_id) WHERE revoked_at IS NULL;
CREATE INDEX pro_categories_lookup_idx
  ON photographer_categories (category_id, certified_tier) WHERE revoked_at IS NULL;


CREATE TABLE photographer_gear (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  kind            text NOT NULL,        -- BODY | LENS | LIGHTING | DRONE | OTHER
  make_model      text NOT NULL,
  sensor_format   text,                 -- FULL_FRAME | APS_C | MFT
  supports_dual_card boolean,
  serial_last4    char(4),
  verified_at     timestamptz,
  verified_by     uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pro_gear_idx ON photographer_gear (photographer_id, kind);


CREATE TABLE photographer_bank_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id    uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  account_holder     text NOT NULL,
  account_number_enc bytea NOT NULL,     -- encrypted at rest, app-side key
  account_last4      char(4) NOT NULL,
  ifsc               text NOT NULL,
  bank_name          text,
  upi_vpa            text,
  is_primary         boolean NOT NULL DEFAULT true,
  -- manual verification: ops confirmed against the uploaded bank proof
  verified_at        timestamptz,
  verified_by        uuid REFERENCES staff_users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ifsc_format CHECK (ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$')
);
CREATE UNIQUE INDEX pro_bank_primary_uq
  ON photographer_bank_accounts (photographer_id) WHERE is_primary;


-- G-44: the vendor services agreement. Contractor status defence.
CREATE TABLE photographer_contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  contract_version text NOT NULL,
  storage_key     text,                 -- signed PDF
  signed_at       timestamptz NOT NULL,
  signed_ip       inet,
  valid_from      date NOT NULL,
  valid_to        date NOT NULL,
  terminated_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contract_window CHECK (valid_to > valid_from)
);
CREATE INDEX pro_contracts_idx ON photographer_contracts (photographer_id, valid_to DESC);


-- Recurring weekly availability.
CREATE TABLE photographer_availability (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  iso_dow         smallint NOT NULL,     -- 1=Mon .. 7=Sun
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dow_range CHECK (iso_dow BETWEEN 1 AND 7),
  CONSTRAINT avail_window CHECK (end_time > start_time)
);
CREATE INDEX pro_availability_idx ON photographer_availability (photographer_id, iso_dow);


-- One-off blocks: leave, personal bookings, ops-imposed suspension windows.
CREATE TABLE photographer_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  blocked_from    timestamptz NOT NULL,
  blocked_until   timestamptz NOT NULL,
  reason          text,
  created_by_staff uuid REFERENCES staff_users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT block_window CHECK (blocked_until > blocked_from),
  EXCLUDE USING gist (
    photographer_id WITH =,
    tstzrange(blocked_from, blocked_until, '[)') WITH &&
  )
);


-- Rolling aggregates. Recomputed by a nightly job, NOT the source of truth.
-- Drives dispatch ranking and the Pro app's transparency card.
CREATE TABLE photographer_metrics (
  photographer_id       uuid PRIMARY KEY REFERENCES photographers(id) ON DELETE CASCADE,
  shoots_completed      integer NOT NULL DEFAULT 0,
  rating_avg_bps        integer,          -- 4.87 → 4870
  rating_count          integer NOT NULL DEFAULT 0,
  acceptance_rate_bps   integer,
  on_time_upload_rate_bps integer,
  no_show_count         smallint NOT NULL DEFAULT 0,
  data_loss_count       smallint NOT NULL DEFAULT 0,
  escalation_count      smallint NOT NULL DEFAULT 0,
  lifetime_payout_paise bigint NOT NULL DEFAULT 0,
  city_rank             integer,
  computed_at           timestamptz NOT NULL DEFAULT now()
);


CREATE TABLE photographer_penalties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id uuid NOT NULL REFERENCES photographers(id) ON DELETE CASCADE,
  booking_id      uuid,
  kind            text NOT NULL,     -- NO_SHOW | LATE_UPLOAD | SLA_BREACH | CONDUCT | DATA_LOSS
  severity        smallint NOT NULL, -- 1 warning, 2 deactivation, 3 removal
  payout_deduction_bps integer NOT NULL DEFAULT 0,
  deactivation_days    smallint,
  waived              boolean NOT NULL DEFAULT false,
  waive_reason        text,
  note                text,
  issued_by           uuid REFERENCES staff_users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT penalty_severity_range CHECK (severity BETWEEN 1 AND 3),
  CONSTRAINT penalty_deduction_range CHECK (payout_deduction_bps BETWEEN 0 AND 10000)
);
CREATE INDEX pro_penalties_idx ON photographer_penalties (photographer_id, created_at DESC);


-- ============================================================================
-- §7  BOOKINGS
-- ============================================================================

CREATE SEQUENCE booking_reference_seq START 1000;

CREATE TABLE bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference          text NOT NULL DEFAULT ('CLK-' || nextval('booking_reference_seq')),
  status             booking_status NOT NULL DEFAULT 'DRAFT',

  user_id            uuid NOT NULL REFERENCES users(id),
  city_id            uuid NOT NULL REFERENCES cities(id),
  category_id        uuid NOT NULL REFERENCES categories(id),
  tier               plan_tier NOT NULL,

  -- schedule (all timestamptz; render in Asia/Kolkata)
  scheduled_start    timestamptz NOT NULL,
  scheduled_hours    numeric(4,1) NOT NULL,
  scheduled_end      timestamptz GENERATED ALWAYS AS
                       (clickco_add_minutes(scheduled_start, (scheduled_hours * 60)::int)) STORED,
  emergency_band     emergency_band NOT NULL DEFAULT 'NONE',

  -- venue
  venue_pincode      char(6) NOT NULL,
  venue_address      text NOT NULL,
  venue_location     geography(Point, 4326),
  venue_landmark     text,
  travel_zone        smallint NOT NULL DEFAULT 0,
  travel_distance_km numeric(6,2),

  -- G-08: booker may differ from the person at the venue
  booker_name        text NOT NULL,
  booker_phone       text NOT NULL,
  subject_name       text,
  subject_phone      text,
  gallery_recipient  text NOT NULL DEFAULT 'BOOKER',   -- BOOKER | SUBJECT

  special_requirements text,

  -- pricing (denormalised from the snapshot for querying; snapshot is truth)
  ruleset_id         uuid NOT NULL REFERENCES pricing_rulesets(id),
  total_paise        bigint NOT NULL DEFAULT 0,
  advance_paise      bigint NOT NULL DEFAULT 0,
  balance_paise      bigint NOT NULL DEFAULT 0,
  amount_paid_paise  bigint NOT NULL DEFAULT 0,
  amount_refunded_paise bigint NOT NULL DEFAULT 0,

  -- SLA anchor. T0 = actual_check_out. NOT booking creation.
  actual_check_in    timestamptz,
  actual_check_out   timestamptz,
  sla_t0             timestamptz,
  delivery_due_at    timestamptz,
  delivered_at       timestamptz,

  expected_frames    integer,
  quote_expires_at   timestamptz,
  cancelled_at       timestamptz,
  cancellation_reason text,
  closed_at          timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_hours_min CHECK (scheduled_hours >= 2.0),
  CONSTRAINT booking_hours_increment CHECK ((scheduled_hours * 2) = floor(scheduled_hours * 2)),
  CONSTRAINT booking_money_nonneg CHECK (
    total_paise >= 0 AND advance_paise >= 0 AND balance_paise >= 0
    AND amount_paid_paise >= 0 AND amount_refunded_paise >= 0
  ),
  CONSTRAINT booking_advance_plus_balance CHECK (advance_paise + balance_paise = total_paise),
  CONSTRAINT booking_recipient_valid CHECK (gallery_recipient IN ('BOOKER','SUBJECT')),
  CONSTRAINT booking_subject_phone_if_recipient CHECK (
    gallery_recipient <> 'SUBJECT' OR subject_phone IS NOT NULL
  ),
  CONSTRAINT booking_checkout_after_checkin CHECK (
    actual_check_out IS NULL OR actual_check_in IS NULL
    OR actual_check_out > actual_check_in
  )
);
CREATE UNIQUE INDEX bookings_reference_uq ON bookings (reference);
CREATE INDEX bookings_user_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_city_schedule_idx ON bookings (city_id, scheduled_start);
-- the ops live board: only in-flight bookings
CREATE INDEX bookings_active_idx ON bookings (status, scheduled_start)
  WHERE status NOT IN ('CLOSED','CANCELLED_CLIENT','CANCELLED_PRO','ABANDONED');
-- the SLA board: sorted by time to breach
CREATE INDEX bookings_delivery_due_idx ON bookings (delivery_due_at)
  WHERE delivered_at IS NULL AND delivery_due_at IS NOT NULL;
CREATE INDEX bookings_venue_gix ON bookings USING gist (venue_location);
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- IMMUTABLE. This is what you show in a dispute or an audit.
CREATE TABLE booking_price_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  ruleset_id        uuid NOT NULL REFERENCES pricing_rulesets(id),
  ruleset_version   text NOT NULL,
  sequence          smallint NOT NULL DEFAULT 1,   -- 1 = original, 2+ = extensions

  -- resolved inputs
  tier              plan_tier NOT NULL,
  city_tier         city_tier NOT NULL,
  category_code     text NOT NULL,
  hours             numeric(4,1) NOT NULL,

  -- resolved factors, all bps
  base_rate_per_hour_paise bigint NOT NULL,
  category_uplift_bps      integer NOT NULL,
  emergency_multiplier_bps integer NOT NULL,
  surge_multiplier_bps     integer NOT NULL,
  night_multiplier_bps     integer NOT NULL,
  weekend_multiplier_bps   integer NOT NULL,

  -- computed lines
  base_amount_paise    bigint NOT NULL,
  addons_amount_paise  bigint NOT NULL DEFAULT 0,
  travel_amount_paise  bigint NOT NULL DEFAULT 0,
  discount_amount_paise bigint NOT NULL DEFAULT 0,
  taxable_amount_paise bigint NOT NULL,
  gst_rate_bps         integer NOT NULL,
  gst_amount_paise     bigint NOT NULL,
  total_amount_paise   bigint NOT NULL,
  prices_include_gst   boolean NOT NULL,

  -- expected vendor cost, computed at quote time for margin visibility
  payout_share_bps     integer NOT NULL,
  expected_payout_paise bigint NOT NULL,

  -- full itemised breakdown exactly as rendered to the client
  breakdown         jsonb NOT NULL,
  promo_code        text,
  computed_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT snapshot_totals_balance CHECK (
    taxable_amount_paise = base_amount_paise + addons_amount_paise
                         + travel_amount_paise - discount_amount_paise
  ),
  CONSTRAINT snapshot_total_check CHECK (
    total_amount_paise = taxable_amount_paise + gst_amount_paise
  ),
  CONSTRAINT snapshot_amounts_nonneg CHECK (
    base_amount_paise >= 0 AND addons_amount_paise >= 0
    AND travel_amount_paise >= 0 AND discount_amount_paise >= 0
    AND gst_amount_paise >= 0 AND total_amount_paise >= 0
  )
);
CREATE UNIQUE INDEX price_snapshots_uq ON booking_price_snapshots (booking_id, sequence);
-- immutability: no UPDATE, ever
CREATE TRIGGER price_snapshots_immutable
  BEFORE UPDATE ON booking_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_update();


CREATE TABLE booking_addons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id      uuid NOT NULL REFERENCES addons(id),
  quantity      smallint NOT NULL DEFAULT 1,
  amount_paise  bigint NOT NULL,
  -- G-05 drone: recorded outcome of the Digital Sky airspace check
  airspace_check_status text,     -- CLEAR | RESTRICTED | PENDING | NOT_APPLICABLE
  airspace_checked_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT booking_addon_qty CHECK (quantity > 0),
  CONSTRAINT booking_addon_amount CHECK (amount_paise >= 0)
);
CREATE UNIQUE INDEX booking_addons_uq ON booking_addons (booking_id, addon_id);


-- APPEND-ONLY. Every transition, forever. This is the booking timeline in
-- the admin panel and the evidence pack in a chargeback.
CREATE TABLE booking_status_events (
  id             bigserial PRIMARY KEY,
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  from_status    booking_status,
  to_status      booking_status NOT NULL,
  actor_kind     text NOT NULL,          -- SYSTEM | USER | PHOTOGRAPHER | STAFF
  actor_id       uuid,
  reason         text,
  metadata       jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_status_events_idx ON booking_status_events (booking_id, occurred_at);
CREATE TRIGGER booking_status_events_append_only
  BEFORE UPDATE OR DELETE ON booking_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ============================================================================
-- §8  DISPATCH & ASSIGNMENT
-- ============================================================================

CREATE TABLE dispatch_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  wave          smallint NOT NULL,        -- 1..4; emergency uses a single wave 1
  radius_km     numeric(5,1) NOT NULL,
  candidate_count smallint NOT NULL,
  window_seconds smallint NOT NULL,
  is_broadcast  boolean NOT NULL DEFAULT false,   -- emergency: all at once
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz,
  outcome       text                       -- FILLED | EXHAUSTED | CANCELLED
);
CREATE UNIQUE INDEX dispatch_rounds_uq ON dispatch_rounds (booking_id, wave);


CREATE TABLE dispatch_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        uuid NOT NULL REFERENCES dispatch_rounds(id) ON DELETE CASCADE,
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  photographer_id uuid NOT NULL REFERENCES photographers(id),
  rank_score      numeric(8,4),
  distance_km     numeric(6,2),
  offered_payout_paise bigint NOT NULL,
  notified_at     timestamptz NOT NULL DEFAULT now(),
  notified_channels text[],               -- PUSH | WHATSAPP | VOICE
  expires_at      timestamptz NOT NULL,
  responded_at    timestamptz,
  outcome         dispatch_outcome NOT NULL DEFAULT 'PENDING',
  decline_reason  text
);
CREATE UNIQUE INDEX dispatch_attempts_uq ON dispatch_attempts (booking_id, photographer_id, round_id);
CREATE INDEX dispatch_attempts_pending_idx ON dispatch_attempts (expires_at)
  WHERE outcome = 'PENDING';
CREATE INDEX dispatch_attempts_pro_idx ON dispatch_attempts (photographer_id, notified_at DESC);


CREATE TABLE assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  photographer_id    uuid NOT NULL REFERENCES photographers(id),
  status             assignment_status NOT NULL DEFAULT 'ASSIGNED',
  is_replacement     boolean NOT NULL DEFAULT false,
  replaced_assignment_id uuid REFERENCES assignments(id),

  -- the calendar block this assignment occupies, incl. travel buffer
  blocked_from       timestamptz NOT NULL,
  blocked_until      timestamptz NOT NULL,

  accepted_at        timestamptz NOT NULL DEFAULT now(),

  -- G-15: geofenced check-in/out. Financial-grade, immutable once written.
  check_in_at        timestamptz,
  check_in_location  geography(Point, 4326),
  check_in_accuracy_m numeric(6,1),
  check_in_distance_m numeric(8,1),
  check_in_offline   boolean NOT NULL DEFAULT false,
  check_in_device_ts timestamptz,          -- local clock when offline-queued

  check_out_at       timestamptz,
  check_out_location geography(Point, 4326),
  check_out_accuracy_m numeric(6,1),
  check_out_offline  boolean NOT NULL DEFAULT false,
  check_out_device_ts timestamptz,

  declared_frame_count integer,
  released_at        timestamptz,
  release_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT assignment_block_window CHECK (blocked_until > blocked_from),
  CONSTRAINT assignment_checkout_order CHECK (
    check_out_at IS NULL OR check_in_at IS NULL OR check_out_at > check_in_at
  ),

  -- G-28: THE double-booking backstop. Application-level Redis locks are the
  -- fast path; this is the guarantee.
  EXCLUDE USING gist (
    photographer_id WITH =,
    tstzrange(blocked_from, blocked_until, '[)') WITH &&
  ) WHERE (status IN ('ASSIGNED','EN_ROUTE','ACTIVE','COMPLETED'))
);
CREATE UNIQUE INDEX assignments_active_per_booking_uq
  ON assignments (booking_id) WHERE status <> 'RELEASED' AND status <> 'ABANDONED';
CREATE INDEX assignments_pro_idx ON assignments (photographer_id, blocked_from DESC);
CREATE TRIGGER assignments_touch BEFORE UPDATE ON assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- G-16: extensions and waiting time. Client-approved, geo-timestamped.
CREATE TABLE assignment_events (
  id             bigserial PRIMARY KEY,
  assignment_id  uuid NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind           text NOT NULL,   -- EXTENSION_REQUESTED | EXTENSION_APPROVED |
                                  -- EXTENSION_DECLINED | WAITING_LOGGED |
                                  -- NOTE | PROOF_UPLOADED | UNSAFE_REPORTED |
                                  -- ACCESS_DENIED_REPORTED
  minutes        smallint,
  amount_paise   bigint,
  note           text,
  location       geography(Point, 4326),
  actor_kind     text NOT NULL,
  actor_id       uuid,
  device_ts      timestamptz,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignment_events_idx ON assignment_events (assignment_id, occurred_at);
CREATE TRIGGER assignment_events_append_only
  BEFORE UPDATE OR DELETE ON assignment_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ============================================================================
-- §9  MEDIA, UPLOAD, DELIVERY
-- ============================================================================

CREATE TABLE upload_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  photographer_id   uuid NOT NULL REFERENCES photographers(id),
  origin            text NOT NULL,     -- WEB_PORTAL (99%) | PRO_APP (proof shots)
  status            upload_session_status NOT NULL DEFAULT 'OPEN',

  declared_file_count integer NOT NULL,
  declared_bytes    bigint NOT NULL,
  received_file_count integer NOT NULL DEFAULT 0,
  received_bytes    bigint NOT NULL DEFAULT 0,

  -- resumability: which multipart parts have landed
  completed_parts   jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  failure_reason    text,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,

  CONSTRAINT upload_counts_nonneg CHECK (
    declared_file_count >= 0 AND received_file_count >= 0
    AND declared_bytes >= 0 AND received_bytes >= 0
  )
);
CREATE INDEX upload_sessions_booking_idx ON upload_sessions (booking_id);
CREATE INDEX upload_sessions_stalled_idx ON upload_sessions (last_activity_at)
  WHERE status IN ('OPEN','UPLOADING');


CREATE TABLE media_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  upload_session_id uuid REFERENCES upload_sessions(id),
  kind             asset_kind NOT NULL,

  -- StoragePort identifiers. Adapter-agnostic: Drive file id today, R2 key later.
  storage_object_id text NOT NULL,
  storage_path     text NOT NULL,
  storage_adapter  text NOT NULL DEFAULT 'GOOGLE_DRIVE',

  original_filename text NOT NULL,
  mime_type        text,
  size_bytes       bigint NOT NULL,
  checksum_md5     text NOT NULL,
  -- verified against the storage provider's returned checksum
  checksum_verified_at timestamptz,

  width_px         integer,
  height_px        integer,
  captured_at      timestamptz,          -- from EXIF
  camera_make_model text,

  -- provenance for the auto-JPEG pipeline
  derived_from_asset_id uuid REFERENCES media_assets(id),

  -- retention: RAW = delivered+7d, JPEG = delivered+30d
  purge_after      timestamptz,
  purged_at        timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT asset_size_positive CHECK (size_bytes > 0)
);
CREATE INDEX media_assets_booking_kind_idx ON media_assets (booking_id, kind);
CREATE UNIQUE INDEX media_assets_object_uq ON media_assets (storage_adapter, storage_object_id);
-- the purge scanner
CREATE INDEX media_assets_purge_idx ON media_assets (purge_after)
  WHERE purged_at IS NULL AND purge_after IS NOT NULL;
CREATE INDEX media_assets_unverified_idx ON media_assets (created_at)
  WHERE checksum_verified_at IS NULL;


CREATE TABLE deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raw_file_count    integer NOT NULL DEFAULT 0,
  raw_bytes         bigint NOT NULL DEFAULT 0,
  jpeg_file_count   integer NOT NULL DEFAULT 0,
  jpeg_bytes        bigint NOT NULL DEFAULT 0,
  video_file_count  integer NOT NULL DEFAULT 0,
  video_bytes       bigint NOT NULL DEFAULT 0,

  -- QA gate before the link is issued
  qa_status         text NOT NULL DEFAULT 'PENDING',  -- PENDING | PASSED | FAILED
  qa_by             uuid REFERENCES staff_users(id),
  qa_at             timestamptz,
  qa_note           text,

  released_at       timestamptz,          -- when payment cleared and links issued
  raw_expires_at    timestamptz,
  jpeg_expires_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX deliveries_booking_uq ON deliveries (booking_id);
CREATE TRIGGER deliveries_touch BEFORE UPDATE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE delivery_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id   uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind          asset_kind NOT NULL,
  -- opaque token in our URL; maps to the provider link server-side
  public_token  text NOT NULL,
  provider_link text NOT NULL,
  provider_link_id text,                  -- for revocation
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  access_count  integer NOT NULL DEFAULT 0,
  first_accessed_at timestamptz,
  last_accessed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX delivery_links_token_uq ON delivery_links (public_token);
CREATE INDEX delivery_links_revoke_idx ON delivery_links (expires_at)
  WHERE revoked_at IS NULL;


-- Weekly reconciliation: declared vs received vs stored.
CREATE TABLE media_integrity_audits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  expected_count    integer NOT NULL,
  db_count          integer NOT NULL,
  provider_count    integer NOT NULL,
  checksum_mismatches integer NOT NULL DEFAULT 0,
  result            text NOT NULL,        -- OK | MISMATCH | PROVIDER_ERROR
  detail            jsonb,
  ran_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_audits_problem_idx ON media_integrity_audits (ran_at)
  WHERE result <> 'OK';


-- Drive quota tracking. Alerts at 60/75/90%. Refuse new sessions past 85%
-- of the rolling daily upload ceiling.
CREATE TABLE storage_quota_samples (
  id             bigserial PRIMARY KEY,
  adapter        text NOT NULL,
  used_bytes     bigint NOT NULL,
  limit_bytes    bigint NOT NULL,
  daily_uploaded_bytes bigint NOT NULL DEFAULT 0,
  daily_limit_bytes    bigint,
  sampled_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX storage_quota_recent_idx ON storage_quota_samples (adapter, sampled_at DESC);


-- ============================================================================
-- §10  SLA MACHINE
-- ============================================================================

CREATE TABLE sla_clocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind         sla_kind NOT NULL,
  state        sla_clock_state NOT NULL DEFAULT 'ARMED',
  anchor_at    timestamptz NOT NULL,       -- usually sla_t0
  due_at       timestamptz NOT NULL,
  -- paused while BALANCE_PENDING: client non-payment is not our breach
  paused_at    timestamptz,
  paused_ms    bigint NOT NULL DEFAULT 0,
  met_at       timestamptz,
  breached_at  timestamptz,
  job_id       text,                       -- BullMQ job id, for cancellation
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sla_clocks_uq ON sla_clocks (booking_id, kind);
-- the scanner: only armed clocks, ordered by due time
CREATE INDEX sla_clocks_armed_idx ON sla_clocks (due_at)
  WHERE state = 'ARMED' AND paused_at IS NULL;
CREATE TRIGGER sla_clocks_touch BEFORE UPDATE ON sla_clocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE sla_breaches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  clock_id          uuid NOT NULL REFERENCES sla_clocks(id),
  kind              sla_kind NOT NULL,
  delay_minutes     integer NOT NULL,
  band              text NOT NULL,        -- H0_6 | H6_24 | H24_72 | H72_PLUS
  client_remedy_kind text NOT NULL,       -- CREDIT | PARTIAL_REFUND | FULL_REFUND
  client_remedy_paise bigint NOT NULL DEFAULT 0,
  payout_deduction_bps integer NOT NULL DEFAULT 0,
  attributed_to     text NOT NULL,        -- PHOTOGRAPHER | CLICKCO | CLIENT | FORCE_MAJEURE
  applied_at        timestamptz,
  waived_by         uuid REFERENCES staff_users(id),
  waive_reason      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sla_breaches_booking_idx ON sla_breaches (booking_id);
CREATE INDEX sla_breaches_unapplied_idx ON sla_breaches (created_at)
  WHERE applied_at IS NULL AND waived_by IS NULL;


-- ============================================================================
-- §11  MONEY
-- ============================================================================

-- GST requires gapless sequential invoice numbers per series per financial
-- year. Allocation must be atomic. Use allocate_invoice_number() below.
CREATE TABLE invoice_series (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,          -- 'CLK-INV'
  financial_year text NOT NULL,          -- '2026-27'
  prefix         text NOT NULL,          -- 'CLK/26-27/'
  last_number    integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX invoice_series_uq ON invoice_series (code, financial_year);

CREATE OR REPLACE FUNCTION allocate_invoice_number(p_code text, p_fy text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_prefix text; v_next integer;
BEGIN
  UPDATE invoice_series
     SET last_number = last_number + 1
   WHERE code = p_code AND financial_year = p_fy AND is_active
  RETURNING prefix, last_number INTO v_prefix, v_next;

  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'No active invoice series % for FY %', p_code, p_fy;
  END IF;

  RETURN v_prefix || lpad(v_next::text, 5, '0');
END $$;


CREATE TABLE invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number     text NOT NULL,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  user_id            uuid NOT NULL REFERENCES users(id),
  purpose            payment_purpose NOT NULL,

  taxable_amount_paise bigint NOT NULL,
  cgst_paise         bigint NOT NULL DEFAULT 0,
  sgst_paise         bigint NOT NULL DEFAULT 0,
  igst_paise         bigint NOT NULL DEFAULT 0,
  total_amount_paise bigint NOT NULL,
  sac_code           text NOT NULL,
  place_of_supply    text NOT NULL,      -- state code, drives CGST/SGST vs IGST

  issued_at          timestamptz NOT NULL DEFAULT now(),
  pdf_storage_key    text,
  cancelled_at       timestamptz,
  cancellation_note  text,

  CONSTRAINT invoice_tax_split CHECK (
    (igst_paise > 0 AND cgst_paise = 0 AND sgst_paise = 0)
    OR (igst_paise = 0)
  ),
  CONSTRAINT invoice_total CHECK (
    total_amount_paise = taxable_amount_paise + cgst_paise + sgst_paise + igst_paise
  )
);
CREATE UNIQUE INDEX invoices_number_uq ON invoices (invoice_number);
CREATE INDEX invoices_booking_idx ON invoices (booking_id);
-- issued invoices are immutable; cancellation is a separate credit note
CREATE TRIGGER invoices_immutable BEFORE DELETE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  user_id            uuid NOT NULL REFERENCES users(id),
  invoice_id         uuid REFERENCES invoices(id),
  purpose            payment_purpose NOT NULL,
  status             payment_status NOT NULL DEFAULT 'CREATED',

  amount_paise       bigint NOT NULL,
  captured_paise     bigint NOT NULL DEFAULT 0,
  refunded_paise     bigint NOT NULL DEFAULT 0,
  gateway_fee_paise  bigint NOT NULL DEFAULT 0,

  provider           text NOT NULL DEFAULT 'RAZORPAY',
  provider_order_id  text,
  provider_payment_id text,
  method             text,               -- UPI | CARD | NETBANKING | WALLET
  vpa_or_last4       text,

  -- emergency <3h: authorise now, capture only on photographer acceptance
  is_auth_only       boolean NOT NULL DEFAULT false,
  authorized_at      timestamptz,
  auth_expires_at    timestamptz,
  captured_at        timestamptz,
  failed_at          timestamptz,
  failure_code       text,
  failure_reason     text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payment_amounts CHECK (
    amount_paise > 0 AND captured_paise >= 0 AND refunded_paise >= 0
    AND captured_paise <= amount_paise
    AND refunded_paise <= captured_paise
  )
);
CREATE UNIQUE INDEX payments_provider_payment_uq
  ON payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX payments_booking_idx ON payments (booking_id, created_at);
CREATE INDEX payments_auth_expiring_idx ON payments (auth_expires_at)
  WHERE status = 'AUTHORIZED';
CREATE TRIGGER payments_touch BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Every gateway webhook, stored raw, deduped. Never trust, always verify.
CREATE TABLE payment_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  provider_event_id text NOT NULL,
  event_type      text NOT NULL,
  signature_valid boolean NOT NULL,
  payload         jsonb NOT NULL,
  processed_at    timestamptz,
  processing_error text,
  received_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_webhooks_uq ON payment_webhook_events (provider, provider_event_id);
CREATE INDEX payment_webhooks_unprocessed_idx ON payment_webhook_events (received_at)
  WHERE processed_at IS NULL;


CREATE TABLE refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  status           refund_status NOT NULL DEFAULT 'REQUESTED',
  amount_paise     bigint NOT NULL,
  reason_code      text NOT NULL,   -- CLIENT_CANCEL | PRO_NO_SHOW | SLA_BREACH |
                                    -- DATA_LOSS | EMERGENCY_UNFILLED | GOODWILL |
                                    -- QUALITY | ACCESS_DENIED
  reason_note      text,
  requested_by_kind text NOT NULL,  -- USER | STAFF | SYSTEM
  requested_by_id  uuid,
  approved_by      uuid REFERENCES staff_users(id),
  approved_at      timestamptz,
  provider_refund_id text,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT refund_amount_positive CHECK (amount_paise > 0)
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);
CREATE INDEX refunds_pending_idx ON refunds (created_at)
  WHERE status IN ('REQUESTED','APPROVED','PROCESSING');


-- Service credits (SLA remedies, goodwill, ₹500 no-show apology).
CREATE TABLE client_credits (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_paise  bigint NOT NULL,
  consumed_paise bigint NOT NULL DEFAULT 0,
  reason_code   text NOT NULL,
  source_booking_id uuid REFERENCES bookings(id),
  issued_by     uuid REFERENCES staff_users(id),
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT credit_amounts CHECK (
    amount_paise > 0 AND consumed_paise >= 0 AND consumed_paise <= amount_paise
  )
);
CREATE INDEX client_credits_available_idx ON client_credits (user_id)
  WHERE consumed_paise < amount_paise;


-- Principal model: the photographer is a vendor who invoices Clickco.
CREATE TABLE vendor_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photographer_id  uuid NOT NULL REFERENCES photographers(id) ON DELETE RESTRICT,
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  vendor_invoice_number text,           -- theirs, if GST-registered
  taxable_amount_paise bigint NOT NULL,
  gst_amount_paise bigint NOT NULL DEFAULT 0,   -- 0 if unregistered → no ITC
  total_amount_paise bigint NOT NULL,
  is_self_billed   boolean NOT NULL DEFAULT true,   -- we generate it for them
  storage_key      text,
  issued_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT vendor_invoice_total CHECK (
    total_amount_paise = taxable_amount_paise + gst_amount_paise
  )
);
CREATE UNIQUE INDEX vendor_invoices_booking_uq ON vendor_invoices (booking_id, photographer_id);


CREATE TABLE payout_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_ref      text NOT NULL,
  status         payout_status NOT NULL DEFAULT 'PENDING',
  total_gross_paise bigint NOT NULL DEFAULT 0,
  total_tds_paise   bigint NOT NULL DEFAULT 0,
  total_net_paise   bigint NOT NULL DEFAULT 0,
  item_count     integer NOT NULL DEFAULT 0,
  approved_by    uuid REFERENCES staff_users(id),
  approved_at    timestamptz,
  processed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_batches_ref_uq ON payout_batches (batch_ref);


CREATE TABLE payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id           uuid REFERENCES payout_batches(id),
  photographer_id    uuid NOT NULL REFERENCES photographers(id) ON DELETE RESTRICT,
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  vendor_invoice_id  uuid REFERENCES vendor_invoices(id),
  bank_account_id    uuid REFERENCES photographer_bank_accounts(id),
  status             payout_status NOT NULL DEFAULT 'PENDING',

  gross_paise        bigint NOT NULL,
  penalty_deduction_paise bigint NOT NULL DEFAULT 0,
  other_deduction_paise   bigint NOT NULL DEFAULT 0,
  tds_section        text,              -- 194C | 194J
  tds_rate_bps       integer NOT NULL DEFAULT 0,
  tds_paise          bigint NOT NULL DEFAULT 0,
  net_paise          bigint NOT NULL,

  eligible_at        timestamptz,       -- delivery + 3 days
  provider           text,
  provider_payout_id text,
  utr                text,
  paid_at            timestamptz,
  failed_at          timestamptz,
  failure_reason     text,
  withheld_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payout_amounts CHECK (
    gross_paise >= 0 AND tds_paise >= 0
    AND penalty_deduction_paise >= 0 AND other_deduction_paise >= 0
    AND net_paise = gross_paise - penalty_deduction_paise
                  - other_deduction_paise - tds_paise
    AND net_paise >= 0
  )
);
CREATE UNIQUE INDEX payouts_booking_pro_uq ON payouts (booking_id, photographer_id);
CREATE INDEX payouts_eligible_idx ON payouts (eligible_at)
  WHERE status = 'PENDING';
CREATE INDEX payouts_pro_idx ON payouts (photographer_id, created_at DESC);
CREATE TRIGGER payouts_touch BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- APPEND-ONLY DOUBLE-ENTRY LEDGER. Balances are derived, never stored.
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  txn_id        uuid NOT NULL,          -- groups the balanced entries
  txn_kind      text NOT NULL,          -- ADVANCE_CAPTURED | BALANCE_CAPTURED |
                                        -- REFUND_ISSUED | PAYOUT_PAID |
                                        -- GST_ACCRUED | TDS_WITHHELD |
                                        -- CREDIT_ISSUED | CREDIT_REDEEMED |
                                        -- GATEWAY_FEE
  account       text NOT NULL,          -- see chart of accounts, Doc 5 §9
  direction     ledger_direction NOT NULL,
  amount_paise  bigint NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',

  booking_id    uuid REFERENCES bookings(id),
  payment_id    uuid REFERENCES payments(id),
  payout_id     uuid REFERENCES payouts(id),
  refund_id     uuid REFERENCES refunds(id),
  photographer_id uuid REFERENCES photographers(id),
  user_id       uuid REFERENCES users(id),

  memo          text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ledger_amount_positive CHECK (amount_paise > 0)
);
CREATE INDEX ledger_txn_idx ON ledger_entries (txn_id);
CREATE INDEX ledger_account_time_idx ON ledger_entries (account, occurred_at);
CREATE INDEX ledger_booking_idx ON ledger_entries (booking_id) WHERE booking_id IS NOT NULL;

CREATE TRIGGER ledger_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Debits must equal credits within every txn_id. DEFERRABLE so the entries
-- can be inserted in any order inside one transaction.
CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_diff bigint;
BEGIN
  SELECT coalesce(sum(CASE WHEN direction = 'DEBIT'  THEN amount_paise ELSE 0 END), 0)
       - coalesce(sum(CASE WHEN direction = 'CREDIT' THEN amount_paise ELSE 0 END), 0)
    INTO v_diff
    FROM ledger_entries WHERE txn_id = NEW.txn_id;

  IF v_diff <> 0 THEN
    RAISE EXCEPTION 'Ledger txn % is unbalanced by % paise', NEW.txn_id, v_diff;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER ledger_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();


-- ============================================================================
-- §12  QUALITY, REVIEWS, DISPUTES
-- ============================================================================

CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  direction       text NOT NULL,        -- CLIENT_TO_PRO | PRO_TO_CLIENT
  rating          smallint NOT NULL,
  comment         text,
  -- sub-scores, client → pro only
  punctuality     smallint,
  professionalism smallint,
  output_quality  smallint,
  is_published    boolean NOT NULL DEFAULT true,
  moderated_by    uuid REFERENCES staff_users(id),
  moderation_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT review_direction_valid CHECK (direction IN ('CLIENT_TO_PRO','PRO_TO_CLIENT'))
);
CREATE UNIQUE INDEX reviews_uq ON reviews (booking_id, direction);


-- G-07: the Quality Manager queue.
CREATE TABLE quality_escalations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  raised_by_kind   text NOT NULL,       -- USER | STAFF | SYSTEM
  raised_by_id     uuid,
  complaint        text NOT NULL,
  affected_asset_ids uuid[],
  status           text NOT NULL DEFAULT 'OPEN',   -- OPEN | IN_REVIEW | RESOLVED | REJECTED
  assigned_qm_id   uuid REFERENCES staff_users(id),
  -- outcomes: RESHOOT | FREE_EDIT | PARTIAL_CREDIT | NO_ACTION
  resolution       text,
  resolution_note  text,
  credit_paise     bigint NOT NULL DEFAULT 0,
  reshoot_booking_id uuid REFERENCES bookings(id),
  -- his call: photographer is paid in full regardless, but it is logged
  photographer_paid_in_full boolean NOT NULL DEFAULT true,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quality_open_idx ON quality_escalations (created_at)
  WHERE status IN ('OPEN','IN_REVIEW');


CREATE TABLE disputes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind           text NOT NULL,   -- CHARGEBACK | BILLING | CONDUCT | DELIVERY | OTHER
  status         text NOT NULL DEFAULT 'OPEN',
  amount_paise   bigint,
  provider_dispute_id text,
  -- evidence pack: geo check-in/out, timestamps, access logs, price snapshot
  evidence       jsonb,
  outcome        text,
  assigned_to    uuid REFERENCES staff_users(id),
  due_at         timestamptz,
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX disputes_open_idx ON disputes (due_at) WHERE resolved_at IS NULL;


-- ============================================================================
-- §13  PLATFORM: EVENTS, AUDIT, IDEMPOTENCY, NOTIFICATIONS
-- ============================================================================

-- Transactional outbox. Domain events are written in the SAME transaction as
-- the state change, then published by a poller. This is what makes the SLA
-- machine and notifications reliable instead of best-effort.
CREATE TABLE domain_events (
  id             bigserial PRIMARY KEY,
  event_id       uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,        -- 'booking.checked_out'
  aggregate_kind text NOT NULL,
  aggregate_id   uuid NOT NULL,
  payload        jsonb NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz,
  publish_attempts smallint NOT NULL DEFAULT 0,
  last_error     text
);
CREATE UNIQUE INDEX domain_events_event_id_uq ON domain_events (event_id);
CREATE INDEX domain_events_unpublished_idx ON domain_events (occurred_at)
  WHERE published_at IS NULL;
CREATE INDEX domain_events_aggregate_idx ON domain_events (aggregate_kind, aggregate_id, occurred_at);
-- published_at is the only mutable column; enforce in the app layer


-- G-33: append-only. Every admin action.
CREATE TABLE audit_logs (
  id             bigserial PRIMARY KEY,
  actor_kind     text NOT NULL,        -- STAFF | SYSTEM | USER | PHOTOGRAPHER
  actor_id       uuid,
  actor_email    text,
  action         text NOT NULL,        -- 'refund.approve'
  entity_kind    text NOT NULL,
  entity_id      uuid,
  before_state   jsonb,
  after_state    jsonb,
  ip_address     inet,
  user_agent     text,
  request_id     text,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_logs (entity_kind, entity_id, occurred_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON audit_logs (action, occurred_at DESC);
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- G-34: every money-mutating request.
CREATE TABLE idempotency_keys (
  key            text PRIMARY KEY,
  scope          text NOT NULL,
  request_hash   text NOT NULL,
  response_status smallint,
  response_body  jsonb,
  locked_at      timestamptz,
  completed_at   timestamptz,
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idempotency_expiry_idx ON idempotency_keys (expires_at);


CREATE TABLE notification_log (
  id             bigserial PRIMARY KEY,
  channel        text NOT NULL,        -- WHATSAPP | PUSH | SMS | EMAIL | VOICE
  template_code  text,
  recipient_kind text NOT NULL,
  recipient_id   uuid,
  recipient_addr text NOT NULL,
  booking_id     uuid REFERENCES bookings(id),
  payload        jsonb,
  provider       text,
  provider_message_id text,
  status         text NOT NULL DEFAULT 'QUEUED',  -- QUEUED|SENT|DELIVERED|READ|FAILED
  failure_reason text,
  sent_at        timestamptz,
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_booking_idx ON notification_log (booking_id, created_at);
CREATE INDEX notification_failed_idx ON notification_log (created_at) WHERE status = 'FAILED';


-- Exotel masked calling. Never expose real numbers.
CREATE TABLE masked_call_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  initiator_kind text NOT NULL,
  initiator_id   uuid NOT NULL,
  virtual_number text NOT NULL,
  provider_call_id text,
  duration_seconds integer,
  recording_key  text,
  status         text,
  started_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX masked_calls_booking_idx ON masked_call_log (booking_id, started_at);


CREATE TABLE feature_flags (
  key          text PRIMARY KEY,
  is_enabled   boolean NOT NULL DEFAULT false,
  enabled_cities uuid[],
  rollout_bps  integer NOT NULL DEFAULT 0,
  description  text,
  updated_by   uuid REFERENCES staff_users(id),
  updated_at   timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- §14  GRANTS — append-only enforced at the privilege level too
-- ============================================================================
-- Triggers stop honest mistakes. Grants stop a compromised app credential.
--
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--     TO clickco_app;
--
--   REVOKE UPDATE, DELETE ON
--     ledger_entries, audit_logs, booking_status_events, assignment_events,
--     photographer_application_events, booking_price_snapshots, invoices
--     FROM clickco_app;
--
--   -- domain_events needs UPDATE for published_at only; use a column grant
--   REVOKE UPDATE, DELETE ON domain_events FROM clickco_app;
--   GRANT UPDATE (published_at, publish_attempts, last_error)
--     ON domain_events TO clickco_app;
--
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO clickco_app;


-- ============================================================================
-- §15  ORM NOTE — revising the earlier Prisma recommendation
-- ============================================================================
-- In Doc 2 I recommended Prisma with $queryRaw for the PostGIS queries. Having
-- now written the schema, that was the wrong call. Prisma cannot express:
--
--   • EXCLUDE USING gist          — the double-booking guarantee (§8)
--   • CONSTRAINT TRIGGER DEFERRABLE — the ledger balance check (§11)
--   • Partial indexes with WHERE   — every hot path in this schema
--   • geography(Point, 4326)       — only as Unsupported(), unusable in queries
--   • Generated columns            — bookings.scheduled_end
--   • Row-level immutability triggers
--
-- With Prisma you'd hand-write raw SQL migrations for most of the above and
-- then fight the schema drift detector forever.
--
-- RECOMMENDATION: Drizzle ORM.
--   - SQL-first by design; this file becomes the migration, not a translation
--   - Custom column types handle geography cleanly
--   - drizzle-kit generates migrations from TS definitions that can express
--     partial indexes and check constraints
--   - Raw SQL is a first-class citizen, not an escape hatch
--   - Inferred types feed straight into packages/contracts
--
-- Either way: THIS SQL IS THE SOURCE OF TRUTH. The ORM reads the schema; it
-- does not define it. Put that in apps/api/CLAUDE.md so Claude Code never
-- "helpfully" regenerates the schema from the ORM's model file.


-- ============================================================================
-- §16  DEFERRED TO A LATER ITERATION
-- ============================================================================
-- support_tickets, ticket_messages    → with the admin panel spec
-- clickco_edit_orders, edit_queue     → when Clickco Edit is specified
-- editor_users, editor_assignments    → same
-- referral_codes, referrals           → deferred by decision (G-10)
-- b2b_accounts, purchase_orders       → manual for now (G-09)
-- standby_shifts                      → dropped by decision (G-11)
-- ============================================================================
