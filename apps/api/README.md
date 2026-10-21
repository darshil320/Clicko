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
```

Integration tests run only when `TEST_DATABASE_URL` points at **localhost** (they create and drop scratch databases):
`TEST_DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco pnpm test`
Migrations 0001/0002 are generated from `docs/` by `pnpm db:sync-spec` — never hand-edit them (ADR-0006).
