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

## Staff admin (ADR-0025)

- `modules/admin` owns staff_users, staff_role_grants and audit_logs. Every `/admin` controller has
  `@UseInterceptors(AuditLogInterceptor)`; every route outside `/admin/auth` has
  `@UseGuards(StaffGuard)` + `@Roles(...)` (fail closed); entity routes add `@CityScoped(...)`.
  Every mutating `/admin` route needs `@Audited(action)` — `audited-routes.test.ts` enumerates them.
- Audit rows go through `AuditService.record(tx, …)` inside the change's own transaction; a domain
  service in another module takes a `TxHook` (common/tx-hook.ts) to run it there.
- Cross-module SQL filters (city scope, needs-attention) are `IdSubquery`s built by the owning module.
- First SUPER_ADMIN: `pnpm --filter @clickco/api staff:create <email> "<name>" SUPER_ADMIN` prints a
  temporary password once; the authenticator is enrolled at first sign-in.
- **Development only** — `pnpm db:seed:dev` seeds one account per role, all with password
  `clickco-dev-staff-only` and the PUBLIC authenticator secret `CLICKCODEVSTAFFTOTPSECRETAAAAAAA`
  (add it to any authenticator app, or run `pnpm --filter @clickco/api staff:totp <email>` for the
  current code): super-admin@, city-manager@ (Surat), ops@, quality@, support@, finance@,
  read-only@ — all `@clickco.test`. Never use these anywhere but a local database.
- The panel (http://localhost:3001) calls the API from the browser: `CORS_ORIGINS` in
  apps/api/.env must include `http://localhost:3001` (there is no built-in default).
