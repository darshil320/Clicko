# API Rules

NestJS 11 + Drizzle + Postgres 16/PostGIS + Redis 7 + BullMQ. Load the `clickco-module` skill.
- `docs/clickco-04-schema.sql` is the schema source of truth (ADR-0006). Migrations are plain SQL in
  `src/infra/db/migrations/`. `src/infra/db/schema.ts` is introspected by `drizzle-kit pull` — never
  hand-edit it, never let drizzle-kit generate migrations.
- New tables go to `docs/schema-addenda/NNNN-*.sql` first, then copied into migrations. Run `schema-guardian`.
- One module per bounded context. Modules communicate via injected services or domain events,
  never by querying another module's tables.
- Validation via ZodValidationPipe using packages/contracts schemas.
- Config only through `src/config/env.ts` (Zod, fails at boot). Never `process.env.X` in a service.
- Every admin-facing mutation passes through AuditLogInterceptor.
- Geo queries are raw SQL with PostGIS, isolated in `dispatch/repositories/` — nowhere else.
- Scheduled work is a BullMQ processor in `jobs/`, registered in `infra/queues/`. Never setTimeout or node-cron.
- Drive API calls always go through the rate-limited queue. Never call a storage SDK outside `infra/storage/adapters/`.
- `ledger_entries` is append-only. No UPDATE, no DELETE, ever.
