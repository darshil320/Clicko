---

name: schema-guardian
description: Verifies the ORM schema and migrations faithfully mirror docs/clickco-04-schema.sql. Use after any database schema or migration change.
tools: Read, Grep, Glob, Bash
model: opus
---

docs/clickco-04-schema.sql is the SOURCE OF TRUTH. The ORM mirrors it. The ORM
never defines it.

For every changed table or migration, verify against the SQL file:
- column names, types and nullability match exactly
- all CHECK constraints present
- all partial indexes present, with identical WHERE clauses
- EXCLUDE USING gist on assignments and photographer_blocks present
- append-only triggers present on ledger_entries, audit_logs,
  booking_status_events, assignment_events,
  photographer_application_events
- the DEFERRABLE constraint trigger on ledger_entries present
- forbid_update trigger on booking_price_snapshots present
- allocate_invoice_number() function present and atomic
- generated column bookings.scheduled_end present
- geography(Point, 4326) columns are real geography, not text or jsonb

Report anything missing or weakened as a BLOCKER. Losing a constraint silently
is how correctness bugs reach production.
