# @clickco/api

```bash
pnpm db:up                      # from repo root: Postgres 16 + PostGIS on :5433, Redis on :6379
cp .env.example apps/api/.env   # then fill in the local values below
pnpm --filter @clickco/api db:migrate
pnpm --filter @clickco/api dev
curl localhost:4000/health
```

Local-only values (match `docker-compose.yml`; not secrets):

```
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco
REDIS_URL=redis://:clickco_local_only@localhost:6380
JWT_ACCESS_SECRET=local-dev-access-secret-at-least-32-chars
OTP_HASH_PEPPER=local-dev-otp-pepper-at-least-32-chars
SMS_ADAPTER=console
DEV_TOOLS=on
```

`DEV_TOOLS=on` mounts the `/dev/*` helpers the ops console uses (development + localhost database
only). These secrets are refused in staging and production, where each must be 32 random bytes.

Then `pnpm --filter @clickco/api db:seed` loads Surat, Mumbai and Vadodara. With `SMS_ADAPTER=console`
the OTP is printed to the API log.

## Sprint 1 endpoints

| Method | Path                     | Auth                 |
| ------ | ------------------------ | -------------------- |
| POST   | /auth/otp/request        | public, rate-limited |
| POST   | /auth/otp/verify         | public               |
| POST   | /auth/refresh            | refresh token        |
| POST   | /auth/logout             | refresh token        |
| GET    | /me                      | bearer               |
| GET    | /serviceability/:pincode | public               |
| POST   | /waitlist                | public               |
| GET    | /health                  | public               |

Integration tests run only when `TEST_DATABASE_URL` points at **localhost** (they create and drop scratch databases):
`TEST_DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco pnpm test`
Migrations 0001/0002 are generated from `docs/` by `pnpm db:sync-spec` — never hand-edit them (ADR-0006).
