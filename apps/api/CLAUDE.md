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

## Database roles (security audit M4, migration 0011)

- Append-only tables (audit_logs, ledger_entries, credit_notes, review_resolutions,
  booking_status_events, assignment_events, photographer_application_events, ticket_messages,
  booking_price_snapshots, invoices) refuse UPDATE/DELETE **and TRUNCATE** by trigger.
- Migration 0011 creates `clickco_app` (NOLOGIN): SELECT/INSERT only on append-only tables,
  column-limited UPDATE on domain_events and invoices, never TRUNCATE. A later append-only table
  must `REVOKE UPDATE, DELETE … FROM clickco_app` and add a `BEFORE TRUNCATE` trigger itself.
- Deploy (staging/production):
  1. The table **owner** runs migrations only: `MIGRATION_DATABASE_URL=postgres://<owner>…`
     (`pnpm --filter @clickco/api db:migrate` uses it when set, else DATABASE_URL).
  2. Once per environment: `CREATE ROLE clickco_api LOGIN PASSWORD '<secret>' IN ROLE clickco_app;`
  3. `DATABASE_URL` uses `clickco_api`. The API refuses to boot in staging/production if
     `current_user` owns audit_logs (or is a member of the owner, or a superuser) —
     `infra/db/runtime-role-check.ts`.
- Locally the single `clickco` superuser does both; the check is skipped in development and test.

## Media worker (security audit H1, ADR-0027 D6a)

darktable parses untrusted RAW files, so in staging/production it runs only in the separate media
worker: `node dist/worker.js` (`pnpm --filter @clickco/api start:worker`, `src/worker.ts` +
`worker.module.ts`: the media-export processor and nothing else). Set `MEDIA_WORKER_ISOLATED=true`
on BOTH the API and the worker; env.ts refuses `JPEG_EXPORT_ADAPTER=darktable` when deployed
without it, and the API then neither consumes `media-export` nor registers the processor.
In code: RAW size cap (`MEDIA_CONFIG.maxExportRawBytes`), `ulimit -v` on Linux
(`darktableMemoryLimitMb`), 120 s timeout, file-signature check, a stripped child environment.

The worker's container must be hardened (launch checklist, S12):
- **No app secrets**: none of JWT_ACCESS_SECRET, OTP_HASH_PEPPER, STAFF_TOTP_KEY,
  BANK_ACCOUNT_KEY, DELIVERY_LINK_KEY, RAZORPAY_*, SANDBOX_WEBHOOK_SECRET. Its own DB role limited
  to the media tables and its own Redis ACL user limited to the `media-export` queue keys — never
  the API's credentials. darktable itself inherits none of them (`darktableEnv`).
- **No network** except Postgres, Redis and the storage provider (egress allow-list); darktable's
  child has none (run it in a network namespace / sidecar where the platform allows).
- **Non-root** user, **read-only root filesystem**, a size-limited tmpfs for `/tmp` (the export
  work dir), no Docker socket, `no-new-privileges`, all capabilities dropped.
- **seccomp** (the runtime default profile at least) and AppArmor/SELinux where available.
- **cgroup limits**: memory (e.g. 8 GiB, above the 6 GiB `ulimit -v`), CPU (2 cores for the 2
  concurrent exports), pids (e.g. 256). The cgroup memory limit is the authoritative cap.
