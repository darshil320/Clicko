-- ============================================================================
-- CLICKCO — SCHEMA ADDENDUM 0011 · append-only hardening (security audit M4,
-- ADR-0027). Implements spec §14 (GRANTS) and closes two gaps:
--
--   (a) The append-only triggers cover UPDATE and DELETE but not TRUNCATE,
--       which fires neither row nor UPDATE/DELETE statement triggers.
--   (b) The app connected as the role that OWNS the tables, so it could
--       DISABLE or DROP those triggers. The runtime now gets clickco_app, a
--       least-privilege role; the owner only runs migrations
--       (MIGRATION_DATABASE_URL). The API refuses to boot in staging and
--       production as the owner (infra/db/runtime-role-check.ts).
--
-- Re-runnable: CREATE OR REPLACE TRIGGER, an idempotent CREATE ROLE, and
-- grants rebuilt from REVOKE ALL on every run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. TRUNCATE triggers. forbid_mutation() raises before it returns, so it
--    serves a statement-level TRUNCATE trigger as written (TG_OP = TRUNCATE).
--    Every table carrying a forbid_mutation/forbid_update trigger is covered.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER ledger_entries_no_truncate
  BEFORE TRUNCATE ON ledger_entries
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER credit_notes_no_truncate
  BEFORE TRUNCATE ON credit_notes
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER review_resolutions_no_truncate
  BEFORE TRUNCATE ON review_resolutions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER booking_status_events_no_truncate
  BEFORE TRUNCATE ON booking_status_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER assignment_events_no_truncate
  BEFORE TRUNCATE ON assignment_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER pro_app_events_no_truncate
  BEFORE TRUNCATE ON photographer_application_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE OR REPLACE TRIGGER ticket_messages_no_truncate
  BEFORE TRUNCATE ON ticket_messages
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
-- immutable once written (forbid_update) — a TRUNCATE would erase the price
CREATE OR REPLACE TRIGGER price_snapshots_no_truncate
  BEFORE TRUNCATE ON booking_price_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
-- issued invoices are never deleted (invoices_immutable) — nor truncated
CREATE OR REPLACE TRIGGER invoices_no_truncate
  BEFORE TRUNCATE ON invoices
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ----------------------------------------------------------------------------
-- 2. The application role. NOLOGIN placeholder: each environment creates its
--    own LOGIN role IN ROLE clickco_app (apps/api/CLAUDE.md). Roles are
--    cluster-wide, so parallel test databases may race to create it.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clickco_app') THEN
    CREATE ROLE clickco_app NOLOGIN;
  END IF;
EXCEPTION WHEN duplicate_object OR unique_violation THEN
  NULL; -- created concurrently by another migration run on this server
END $$;

GRANT USAGE ON SCHEMA public TO clickco_app;


-- ----------------------------------------------------------------------------
-- 3. Table grants. Rebuilt on every run: REVOKE ALL, then grant. TRUNCATE is
--    never granted. Extension-owned tables (PostGIS spatial_ref_sys) are
--    skipped — PostGIS already grants SELECT on them to PUBLIC.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  -- the app adds rows, never rewrites or removes them
  insert_only CONSTANT text[] := ARRAY[
    'audit_logs', 'ledger_entries', 'credit_notes', 'review_resolutions',
    'booking_status_events', 'assignment_events',
    'photographer_application_events', 'ticket_messages',
    'booking_price_snapshots'
  ];
  missing text[];
  t record;
BEGIN
  SELECT array_agg(name) INTO missing
    FROM unnest(insert_only) AS name
   WHERE to_regclass('public.' || name) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'append-only tables missing from the schema: %', missing;
  END IF;

  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p', 'v', 'm')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM clickco_app', t.relname);
    IF t.relname = ANY (insert_only) THEN
      EXECUTE format('GRANT SELECT, INSERT ON TABLE public.%I TO clickco_app', t.relname);
    ELSIF t.relname = 'schema_migrations' THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO clickco_app', t.relname);
    ELSE
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO clickco_app',
        t.relname);
    END IF;
  END LOOP;
END $$;

-- The outbox: events are written once; the publisher only records delivery.
-- (Column UPDATE also satisfies SELECT ... FOR UPDATE SKIP LOCKED.)
REVOKE UPDATE, DELETE ON domain_events FROM clickco_app;
GRANT UPDATE (published_at, publish_attempts, last_error, next_attempt_at)
  ON domain_events TO clickco_app;

-- Issued invoices are never re-priced or deleted (cancellation is a credit
-- note). Only the PDF key and the cancellation marker may change, and the
-- credit-note path locks the invoice row (SELECT ... FOR UPDATE), which needs
-- UPDATE on at least one column.
REVOKE UPDATE, DELETE ON invoices FROM clickco_app;
GRANT UPDATE (pdf_storage_key, cancelled_at, cancellation_note)
  ON invoices TO clickco_app;


-- ----------------------------------------------------------------------------
-- 4. Sequences (bigserial ids) and functions.
--    Functions need nothing: EXECUTE is granted to PUBLIC by default, and
--    trigger functions are not checked against the invoking role.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  s record;
BEGIN
  FOR s IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'S'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype = 'e')
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO clickco_app', s.relname);
  END LOOP;
END $$;


-- ----------------------------------------------------------------------------
-- 5. Defaults for tables and sequences created by later migrations (run as
--    this same owner role). A LATER APPEND-ONLY TABLE MUST, in its own
--    migration: REVOKE UPDATE, DELETE ON <table> FROM clickco_app; and add a
--    BEFORE TRUNCATE ... FOR EACH STATEMENT trigger alongside its
--    UPDATE/DELETE one.
-- ----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO clickco_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO clickco_app;
