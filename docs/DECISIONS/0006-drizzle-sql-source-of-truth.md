# ADR-0006 — Drizzle ORM; `clickco-04-schema.sql` is the source of truth

**Status:** Accepted · **Source:** schema §15 (supersedes doc 02's Prisma recommendation)

Prisma cannot express EXCLUDE constraints, deferrable constraint triggers, partial indexes, `geography(Point, 4326)`, generated columns or immutability triggers.

- Migrations are plain SQL under `apps/api/src/infra/db/migrations/`. `0001` is a verbatim copy of `docs/clickco-04-schema.sql`; later files are additive (`docs/schema-addenda/` first, then copied).
- Drizzle table definitions are **introspected** from a migrated database (`drizzle-kit pull`) into `apps/api/src/infra/db/schema.ts`. They are never hand-authored and never generate migrations.
- `schema-guardian` verifies every migration against the SQL.
