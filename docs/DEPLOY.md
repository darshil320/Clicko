# Deploying Clickco

The first-deploy runbook. Hosting is ADR-0008. Incidents are in docs/RUNBOOK.md.
Nothing is deployed yet except the website (apps/web on Vercel). Follow the steps in order.

| Piece | Where | Repo files |
|---|---|---|
| `api`: HTTP API + every queue except media-export | Railway | `apps/api/Dockerfile`, `apps/api/railway.json` |
| `media-worker`: RAW → JPEG export (darktable) | Railway | `apps/api/Dockerfile.worker`, `apps/api/railway.worker.json` |
| `postgres`: Postgres 16 + PostGIS | Railway (Docker image) | none |
| `redis`: Redis 7 with TLS and ACL users | Railway | `infra/redis/` |
| Admin panel, upload portal | Vercel | `apps/admin/vercel.json`, `apps/portal/vercel.json` |
| Website | Vercel (live) | `apps/web/vercel.json` |
| Client and Pro apps | EAS | `apps/*/eas.json`, `apps/*/app.config.ts` |
| DNS | Cloudflare | none |
| Secrets | Doppler, synced to Railway and Vercel | none |

These four Railway names are the `<api>`, `<worker>`, `<postgres>` and `<redis>` of RUNBOOK.md:
`api`, `media-worker`, `postgres`, `redis`. Use exactly these names. The hostnames below depend on them.

---

## 0. Read first: what still blocks a production boot

The deploy files are ready. The API itself still refuses to boot in staging or production until
these are done. This is on purpose (env.ts refuses unsafe settings).

1. **OTP SMS.** `SMS_ADAPTER=dlt` sends the OTP through MSG91 (built in S12, ADR-0029 D1). It
   needs the DLT-approved OTP template registered as an MSG91 flow (PLAN B6): set
   `MSG91_OTP_FLOW_ID` and `MSG91_OTP_DLT_TEMPLATE_ID` with the MSG91 account below. `console` is
   refused when deployed. Without those values the API cannot start in staging or production.
2. **Provider credentials.** WhatsApp (Meta), MSG91 (DLT), Expo push and Exotel must be real
   adapters. `console` is refused when deployed. See HANDOVER.md §8 for who owes what.
3. **Razorpay keys.** Test-mode keys are fine for a staging run. Live keys for launch.
4. **Media storage.** The Google Drive adapter is a skeleton (PLAN B10). The API boots, but
   uploads and downloads answer 503 `STORAGE_NOT_CONFIGURED` until B10 ships.

You can do sections 1 to 5 and 7 to 10 now. Section 6 (the API) waits for items 1 and 2.
The media worker (section 7) boots without them.

Two places where the plan and the platform disagree. Both are decided below; change them if you like.

- **Redis TLS.** env.ts requires `rediss://` when deployed. Railway's Redis template has no TLS.
  So `redis` is our own small image (`infra/redis/`) with TLS on, using a private CA. The API and
  the worker trust that CA through `REDIS_CA_CERT`. Railway's private network is already encrypted
  (WireGuard), so the alternative is an env.ts exception for `*.railway.internal`. That is a code
  change and an ADR: your call.
- **Point-in-time recovery.** ADR-0008 wants PITR. Railway's PITR is built into Railway's own
  Postgres image. We need PostGIS, so `postgres` runs `postgis/postgis:16-3.4`. On that image the
  "Enable PITR" button will probably not appear. Then you have daily volume backups only (up to
  24 h of data lost in a restore). Check the Backups tab in section 4.2. If PITR is missing, decide:
  accept daily backups at launch, or move to a Postgres host with PITR and PostGIS.

---

## 1. Accounts and tools (owner only)

Create these. Each needs your identity, card or company papers.

| Account | Why | Note |
|---|---|---|
| Railway | API, worker, Postgres, Redis | The worker needs 8 GB RAM and 2 vCPU: pick a plan that allows that per service. |
| Doppler | Every secret | The free plan is enough to start. |
| Expo (EAS) | Mobile builds | Create an organisation, e.g. `clickco`. |
| Apple Developer Program | iOS builds and App Store | Company enrolment needs a D-U-N-S number. Start early. |
| Google Play Console | Android | One-time fee. Company account. |
| Cloudflare | DNS for `clickco.in` | Move the domain's nameservers to Cloudflare. |
| Vercel | Admin and portal | You already have `darshil320s-projects`. |
| Providers | Razorpay, Meta WhatsApp, MSG91, Exotel, Google Cloud (service account) | HANDOVER.md §8. |

Install the command-line tools on your Mac:

```bash
brew install railway dopplerhq/cli/doppler
npm install -g eas-cli
# Vercel: use npx vercel@latest (no install needed)
railway login
doppler login
eas login
```

You never need a database client on your Mac: SQL runs inside the database container (section 4.3).

---

## 2. Doppler: projects, configs and sync

One Doppler project per deployable. The media worker must never receive an API secret, and
separate projects make that impossible to get wrong.

| Doppler project | Config | Syncs to |
|---|---|---|
| `clickco-api` | `prd` | Railway service `api` |
| `clickco-media-worker` | `prd` | Railway service `media-worker` |
| `clickco-postgres` | `prd` | Railway service `postgres` |
| `clickco-redis` | `prd` | Railway service `redis` |
| `clickco-admin` | `prd` | Vercel project `clickco-admin`, Production |
| `clickco-portal` | `prd` | Vercel project `clickco-portal`, Production |

Mobile `EXPO_PUBLIC_*` values are public, not secrets. They live in EAS (section 10.2).

Create the projects:

```bash
for p in clickco-api clickco-media-worker clickco-postgres clickco-redis clickco-admin clickco-portal; do
  doppler projects create "$p"
done
```

Each new project has `dev`, `stg` and `prd` configs. Use `prd` here. A staging copy later is the
same steps with `stg` and a second Railway environment.

**Rules:**
- Change a value in Doppler only. Doppler overwrites Railway and Vercel on every sync, so an edit
  made in their dashboards is lost.
- A few values are shared by two services: `QUEUE_PREFIX`, the Redis passwords inside the two
  `REDIS_URL`s, the Redis CA and the Shared Drive id. The commands below set each in both projects
  at once. Change one, change both. (Doppler can link them with `${project.config.NAME}`, but only
  on a paid plan. A reference inside one config, `${NAME}`, works on every plan.)
- Doppler keeps every old value (secret history). RUNBOOK.md §9 needs old keys after a restore.

**Sync to Railway** (once sections 4 to 7 have created each service): Railway → Account Settings → Tokens →
create a token. Then in Doppler: project → `prd` → Integrations → Railway → paste the token →
pick the project, the `production` environment and the service. Do this once per Railway service.

**Sync to Vercel** (section 8): Doppler → project → `prd` → Integrations → Vercel → pick the project and
the Production environment.

A sync changes the service's variables, and Railway redeploys the service. That is how a changed
secret reaches the API.

---

## 3. Every production variable

Generate random values with the commands shown. Paste nothing by hand that a command can make.
Every command below sets the value straight into Doppler, so it never sits in a file.
In a Doppler value, `${NAME}` means "the secret NAME in this same config".

### 3.1 `clickco-postgres` (the `postgres` service)

| Variable | Value |
|---|---|
| `POSTGRES_USER` | `postgres` (the superuser; only you use it, through `railway ssh`) |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` |
| `POSTGRES_DB` | `clickco` |
| `PGDATA` | `/var/lib/postgresql/data/pgdata` (a Railway volume starts with `lost+found`; Postgres needs an empty folder) |

```bash
doppler secrets set --project clickco-postgres --config prd \
  POSTGRES_USER=postgres POSTGRES_DB=clickco PGDATA=/var/lib/postgresql/data/pgdata \
  POSTGRES_PASSWORD="$(openssl rand -hex 32)"
```

Also make the three database role passwords now. They live in `clickco-api` and `clickco-media-worker`,
and you type them into SQL once in section 4.3.

```bash
doppler secrets set --project clickco-api --config prd \
  OWNER_DB_PASSWORD="$(openssl rand -hex 32)" API_DB_PASSWORD="$(openssl rand -hex 32)"
doppler secrets set --project clickco-media-worker --config prd \
  MEDIA_DB_PASSWORD="$(openssl rand -hex 32)"
```

Hex passwords need no escaping inside a URL.

### 3.2 `clickco-redis` (the `redis` service)

| Variable | Value |
|---|---|
| `REDIS_PASSWORD` | `openssl rand -hex 32`. The API's password (user `default`). |
| `REDIS_WORKER_PASSWORD` | `openssl rand -hex 32`. The media worker's password (user `media-worker`). |
| `QUEUE_PREFIX` | `clickco-prod`, the same as the API's. The worker's ACL keys are built from it. |
| `REDIS_TLS_CERT` | `redis.crt` from 3.3 |
| `REDIS_TLS_KEY` | `redis.key` from 3.3 |

One command block sets the passwords here and the matching `REDIS_URL`s for the API and the worker:

```bash
REDIS_PASSWORD="$(openssl rand -hex 32)"
REDIS_WORKER_PASSWORD="$(openssl rand -hex 32)"
doppler secrets set --project clickco-redis --config prd QUEUE_PREFIX=clickco-prod \
  REDIS_PASSWORD="$REDIS_PASSWORD" REDIS_WORKER_PASSWORD="$REDIS_WORKER_PASSWORD"
doppler secrets set --project clickco-api --config prd \
  REDIS_URL="rediss://default:$REDIS_PASSWORD@redis.railway.internal:6379"
doppler secrets set --project clickco-media-worker --config prd \
  REDIS_URL="rediss://media-worker:$REDIS_WORKER_PASSWORD@redis.railway.internal:6379"
unset REDIS_PASSWORD REDIS_WORKER_PASSWORD
```

### 3.3 The Redis TLS certificate (once)

A private CA signs one server certificate for `redis.railway.internal`. Keep `ca.key` in your
password manager, not on a server: you need it only to renew. The certificate below lasts
825 days. Put the expiry date in your calendar.

```bash
mkdir -p ~/clickco-secrets/redis-tls && cd ~/clickco-secrets/redis-tls
openssl req -x509 -new -nodes -newkey rsa:3072 -sha256 -days 3650 \
  -subj "/CN=Clickco Redis CA" -keyout ca.key -out ca.crt
openssl req -new -nodes -newkey rsa:2048 -subj "/CN=redis.railway.internal" \
  -keyout redis.key -out redis.csr
printf 'subjectAltName=DNS:redis.railway.internal\nextendedKeyUsage=serverAuth\n' > redis.ext
openssl x509 -req -sha256 -days 825 -in redis.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -extfile redis.ext -out redis.crt
openssl x509 -in redis.crt -noout -subject -enddate -ext subjectAltName

doppler secrets set --project clickco-redis --config prd \
  REDIS_TLS_CERT="$(cat redis.crt)" REDIS_TLS_KEY="$(cat redis.key)"
doppler secrets set --project clickco-api --config prd REDIS_CA_CERT="$(cat ca.crt)"
doppler secrets set --project clickco-media-worker --config prd REDIS_CA_CERT="$(cat ca.crt)"
```

Then move `ca.key` into your password manager and delete the folder.
`ca.crt` is public. `redis.key` is a secret.

### 3.4 `clickco-api` (the `api` service)

Fixed values:

| Variable | Value | Why |
|---|---|---|
| `NODE_ENV` | `production` | |
| `PORT` | `4000` | The Railway domain targets this port. |
| `QUEUE_PREFIX` | `clickco-prod` | Lowercase, digits, hyphens. Never change it after launch. |
| `TRUST_PROXY_HOPS` | `1` | Railway's edge is one hop. Use `2` only if you turn on Cloudflare's proxy for `api.`. |
| `CORS_ORIGINS` | `https://admin.clickco.in,https://portal.clickco.in` | The browser apps. https only. |
| `PUBLIC_API_URL` | `https://api.clickco.in` | Exotel posts call status here. |
| `PUBLIC_WEB_URL` | `https://clickco.in` | The website's exact origin. Delivery links point here. If the site lives on `www.`, use that. |
| `DATABASE_URL` | `postgresql://clickco_api:${API_DB_PASSWORD}@postgres.railway.internal:5432/clickco` | The least-privilege runtime role. |
| `MIGRATION_DATABASE_URL` | `postgresql://clickco_owner:${OWNER_DB_PASSWORD}@postgres.railway.internal:5432/clickco` | The table owner. Used only by the pre-deploy migration. |
| `REDIS_URL` | `rediss://default:<REDIS_PASSWORD>@redis.railway.internal:6379` | TLS. Set in 3.2. |
| `REDIS_CA_CERT` | `ca.crt` | Set in 3.3. |
| `MEDIA_WORKER_ISOLATED` | `true` | darktable runs only in the worker. |
| `JPEG_EXPORT_ADAPTER` | `darktable` | |
| `STORAGE_ADAPTER` | `drive` | |
| `PAYMENT_GATEWAY` | `razorpay` | |
| `SMS_ADAPTER` | `dlt` | MSG91 OTP. Needs the `MSG91_OTP_*` values (section 0, B6). |
| `WHATSAPP_ADAPTER` | `meta` | |
| `NOTIFY_SMS_ADAPTER` | `msg91` | |
| `PUSH_ADAPTER` | `expo` | |
| `CALLS_ADAPTER` | `exotel` | |

```bash
doppler secrets set --project clickco-api --config prd \
  NODE_ENV=production PORT=4000 QUEUE_PREFIX=clickco-prod TRUST_PROXY_HOPS=1 \
  CORS_ORIGINS=https://admin.clickco.in,https://portal.clickco.in \
  PUBLIC_API_URL=https://api.clickco.in PUBLIC_WEB_URL=https://clickco.in \
  DATABASE_URL='postgresql://clickco_api:${API_DB_PASSWORD}@postgres.railway.internal:5432/clickco' \
  MIGRATION_DATABASE_URL='postgresql://clickco_owner:${OWNER_DB_PASSWORD}@postgres.railway.internal:5432/clickco' \
  MEDIA_WORKER_ISOLATED=true JPEG_EXPORT_ADAPTER=darktable STORAGE_ADAPTER=drive \
  PAYMENT_GATEWAY=razorpay SMS_ADAPTER=dlt WHATSAPP_ADAPTER=meta NOTIFY_SMS_ADAPTER=msg91 \
  PUSH_ADAPTER=expo CALLS_ADAPTER=exotel
```

Keys we generate. Each must be different. Losing some of them loses data, so read the last column.

| Variable | Command | If lost or changed |
|---|---|---|
| `JWT_ACCESS_SECRET` | `openssl rand -base64 48` | Everyone signs in again. |
| `OTP_HASH_PEPPER` | `openssl rand -base64 48` | Codes in flight stop working. |
| `DELIVERY_LINK_KEY` | `openssl rand -base64 48` | Every delivery link sent so far stops working. |
| `STAFF_TOTP_KEY` | `openssl rand -base64 32` | Every staff member enrols their authenticator again. |
| `BANK_ACCOUNT_KEY` | `openssl rand -base64 32` | Stored bank account numbers become unreadable. Rotation: RUNBOOK.md. |
| `BANK_ACCOUNT_KEY_VERSION` | `2` | Bump only when rotating. |
| `RAZORPAY_WEBHOOK_SECRET` | `openssl rand -hex 32` | Paste the same value into Razorpay (below). |
| `EXOTEL_WEBHOOK_SECRET` | `openssl rand -hex 32` | Hex: the URL needs url-safe characters. |

```bash
doppler secrets set --project clickco-api --config prd \
  JWT_ACCESS_SECRET="$(openssl rand -base64 48)" OTP_HASH_PEPPER="$(openssl rand -base64 48)" \
  DELIVERY_LINK_KEY="$(openssl rand -base64 48)" \
  STAFF_TOTP_KEY="$(openssl rand -base64 32)" BANK_ACCOUNT_KEY="$(openssl rand -base64 32)" \
  BANK_ACCOUNT_KEY_VERSION=2 \
  RAZORPAY_WEBHOOK_SECRET="$(openssl rand -hex 32)" EXOTEL_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

Also copy `STAFF_TOTP_KEY` and `BANK_ACCOUNT_KEY` into your password manager. Doppler is the
primary copy; the password manager is the copy that survives losing Doppler.

Values a provider gives you. Set each with `doppler secrets set --project clickco-api --config prd NAME=value`.

| Variable | Where it comes from |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Account & Settings → API Keys. Test keys for staging, live for launch. |
| Razorpay webhook | Razorpay → Webhooks → URL `https://api.clickco.in/payments/webhooks/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`. |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | The Shared Drive's URL: the part after `/folders/`. Set it in `clickco-media-worker` too. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Google Cloud → service account → Keys → JSON. Then `base64 -i key.json \| tr -d '\n'`. Delete the file afterwards. |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` | Meta Business → WhatsApp → API setup (a system-user token, not a 24-hour one). |
| `MSG91_AUTH_KEY`, `MSG91_SENDER_ID`, `MSG91_DLT_ENTITY_ID` | MSG91 dashboard and your DLT registration (6-letter header, entity id). |
| `MSG91_TEMPLATES` | JSON, one entry per SMS template: `{"<TEMPLATE_CODE>":{"flowId":"…","dltTemplateId":"…"}}`. The API checks it against its template list at boot. |
| `MSG91_OTP_FLOW_ID` | The OTP SMS (`SMS_ADAPTER=dlt`): MSG91 → Flow → the OTP flow's template id. The flow's text is the DLT-approved OTP template with one variable, `##otp##`. Uses the same `MSG91_AUTH_KEY`, `MSG91_SENDER_ID` and `MSG91_DLT_ENTITY_ID`. |
| `MSG91_OTP_DLT_TEMPLATE_ID` | The DLT portal's id for that OTP template (digits). Named in the API's failure logs. |
| `EXPO_ACCESS_TOKEN` | Only if you turn on Expo's enhanced push security. expo.dev → Access tokens. |
| `EXOTEL_ACCOUNT_SID`, `EXOTEL_API_KEY`, `EXOTEL_API_TOKEN`, `EXOTEL_CALLER_ID` | Exotel dashboard → API settings, and your ExoPhone. |
| `EXOTEL_API_HOST` | `api.in.exotel.com` for a Mumbai account. Leave unset for Singapore. |
| Exotel status callback | `https://api.clickco.in/webhooks/exotel/call-status/<EXOTEL_WEBHOOK_SECRET>` |

Never set these in production: `DEV_TOOLS`, `QUEUE_WORKERS`, `SANDBOX_WEBHOOK_SECRET`,
`STORAGE_LOCAL_*`. Leave `DB_POOL_MAX`, `DB_*_TIMEOUT*` and `WHATSAPP_GRAPH_VERSION` at their defaults.

### 3.5 `clickco-media-worker` (the `media-worker` service)

The worker gets only what it needs. It refuses to boot if it sees any API secret
(`WORKER_FORBIDDEN_SECRETS` in env.ts: the JWT, OTP, TOTP, bank, delivery-link, Razorpay,
WhatsApp, MSG91, Expo and Exotel secrets, and `MIGRATION_DATABASE_URL`).

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `QUEUE_PREFIX` | `clickco-prod`, the same as the API's |
| `TRUST_PROXY_HOPS` | `0` (required when deployed; the worker serves no HTTP) |
| `DATABASE_URL` | `postgresql://clickco_media:${MEDIA_DB_PASSWORD}@postgres.railway.internal:5432/clickco` |
| `REDIS_URL` | `rediss://media-worker:<REDIS_WORKER_PASSWORD>@redis.railway.internal:6379`. Set in 3.2. |
| `REDIS_CA_CERT` | `ca.crt`. Set in 3.3. |
| `STORAGE_ADAPTER` | `drive` |
| `GOOGLE_DRIVE_SHARED_DRIVE_ID` | The same as the API's. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | Better: a second service account with access to the same Shared Drive only. |
| `MEDIA_WORKER_ISOLATED`, `JPEG_EXPORT_ADAPTER` | Already `true` and `darktable` in the image. Set them anyway. |

```bash
doppler secrets set --project clickco-media-worker --config prd \
  NODE_ENV=production QUEUE_PREFIX=clickco-prod TRUST_PROXY_HOPS=0 STORAGE_ADAPTER=drive \
  MEDIA_WORKER_ISOLATED=true JPEG_EXPORT_ADAPTER=darktable \
  DATABASE_URL='postgresql://clickco_media:${MEDIA_DB_PASSWORD}@postgres.railway.internal:5432/clickco'
```

### 3.6 `clickco-admin` and `clickco-portal` (Vercel)

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.clickco.in` (public; inlined at build; the build fails without an https value) |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (Vercel then uses pnpm 11 from `packageManager`, as the website does) |

```bash
for p in clickco-admin clickco-portal; do
  doppler secrets set --project "$p" --config prd \
    NEXT_PUBLIC_API_URL=https://api.clickco.in ENABLE_EXPERIMENTAL_COREPACK=1
done
```

---

## 4. Railway: project, database and roles

### 4.1 The project

```bash
cd ~/path/to/Clickco
railway init --name clickco
```

Pick the region closest to India (Southeast Asia, Singapore, unless Railway offers India by then).
Put every service in the same region. Railway → Account → Integrations → GitHub: give Railway
access to `darshil320/Clicko`, so `--repo` below works.

`railway add --repo` deploys at once with default settings. That first attempt fails until you set
the service's root directory and config file. Expected: the steps below redeploy it.

### 4.2 `postgres`

```bash
railway add --service postgres --image postgis/postgis:16-3.4
railway service postgres
railway volume add --mount-path /var/lib/postgresql/data
```

The first deploy fails ("superuser password is not specified") until Doppler syncs. That is
expected. Connect Doppler `clickco-postgres` → service `postgres` (section 2) and wait for the
redeploy. The log ends with `database system is ready to accept connections`.
Do not add a public TCP proxy: nothing outside Railway needs the database.

On the Backups tab: turn on Daily and Weekly backups. Look for "Enable PITR" (section 0).

### 4.3 The roles (once per environment)

Migrations run as `clickco_owner`, who owns every table. The API runs as `clickco_api` and the
worker as `clickco_media`: both are members of `clickco_app`, which cannot UPDATE, DELETE or
TRUNCATE the append-only tables (apps/api/CLAUDE.md, "Database roles"). The API refuses to boot as
the owner or a superuser. PostGIS needs a superuser to install; the postgis image already
installed it in `clickco`. The other extensions are trusted, so the owner's migration creates them.

Read the three passwords from Doppler:

```bash
doppler secrets get OWNER_DB_PASSWORD API_DB_PASSWORD --plain --project clickco-api --config prd
doppler secrets get MEDIA_DB_PASSWORD --plain --project clickco-media-worker --config prd
```

Open a shell on the database container, then start psql in it as the superuser:

```bash
railway ssh --service postgres
# now inside the container:
psql -U postgres -d clickco
```

Paste this, with the three passwords filled in:

```sql
CREATE ROLE clickco_owner LOGIN CREATEROLE PASSWORD '<OWNER_DB_PASSWORD>';
ALTER DATABASE clickco OWNER TO clickco_owner;
CREATE EXTENSION IF NOT EXISTS postgis;

-- Migration 0011 grants to clickco_app; creating it here lets both login roles exist before the
-- first migration, so the first API deploy migrates and boots in one go.
CREATE ROLE clickco_app NOLOGIN;
CREATE ROLE clickco_api LOGIN PASSWORD '<API_DB_PASSWORD>' IN ROLE clickco_app;
CREATE ROLE clickco_media LOGIN PASSWORD '<MEDIA_DB_PASSWORD>' IN ROLE clickco_app;

-- Check: only postgres is a superuser, and PostGIS is installed.
SELECT rolname, rolsuper, rolcanlogin FROM pg_roles WHERE rolname LIKE 'clickco%' OR rolname = 'postgres';
SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
\q
```

Then `exit` the shell. Clear your terminal scrollback (it shows the passwords).

`clickco_media` has the same rights as `clickco_api` for now. A role limited to the media tables
is an S12 item (section 7.1). Its own password already lets you revoke it alone.

Opening a database shell later: `railway connect postgres` if the CLI recognises the image,
otherwise `railway ssh --service postgres` and `psql -U clickco_owner -d clickco`.
Follow RUNBOOK.md §0.3 in every session.

---

## 5. `redis`

```bash
railway add --service redis --repo darshil320/Clicko
railway service redis
railway volume add --mount-path /data
```

In the dashboard, `redis` → Settings:
- Source → Root directory: `/infra/redis`.
- Config-as-code → Railway config file: `/infra/redis/railway.json`.
- Networking: no public domain, no TCP proxy.

Connect Doppler `clickco-redis` → service `redis`. Then deploy from the repository with the new
settings: `railway redeploy --service redis --from-source` (or Deployments → Deploy latest commit).

`infra/redis/start.sh` refuses to start on a missing or weak password, a wrong prefix or a missing
certificate, and says which. It creates two users: `default` for the API, and `media-worker`,
which may touch only `<prefix>:media-export:*` and `<prefix>:storage:uploaded:*`.

Check it:

```bash
railway logs --service redis      # "Ready to accept connections tls"
```

---

## 6. `api` (waits for section 0, items 1 and 2)

```bash
railway add --service api --repo darshil320/Clicko
```

In the dashboard, `api` → Settings:
- Source → Root directory: leave `/`. The Docker build needs the whole workspace.
- Config-as-code → Railway config file: `/apps/api/railway.json`.
- Networking → Generate domain, target port `4000` (a temporary `*.up.railway.app` address).

Connect Doppler `clickco-api` → service `api`. Then `railway redeploy --service api --from-source`.
From then on, every push to `main` that touches the watch paths in `railway.json` deploys again.
What happens on each deploy:

1. Railway builds `apps/api/Dockerfile` (Node 22, non-root, production dependencies only).
2. **Pre-deploy:** `node dist/infra/db/migrate.js`. It uses `MIGRATION_DATABASE_URL` (the owner),
   takes a Postgres advisory lock, and applies new migrations, each in its own transaction. If it
   fails, the deploy stops and the old version keeps running.
3. The new container starts as `clickco_api`. It refuses to boot as the owner (audit M4).
4. Railway waits for `GET /health` to answer 200, then moves traffic. The old container gets
   SIGTERM and 30 s to finish (tini forwards it; Nest closes HTTP, queues, Redis and Postgres).

Read the pre-deploy log: it says `Applied: 0001_…, …` the first time, then `Database is up to date.`

The build log shows `gyp ERR!` lines from `msgpackr-extract`. They are harmless: it is an optional
native speed-up, and BullMQ falls back to its JavaScript decoder.

One trade-off to know: Railway gives the pre-deploy command the service's variables, so
`MIGRATION_DATABASE_URL` is also visible inside the running API container. Someone who gets code
execution in the API could use it to bypass the append-only triggers. The fix is a code change:
let migrate.ts run with only the database URLs, then run it from a separate one-off service that
alone holds the owner URL. Not done yet: your call (S12).

**The first SUPER_ADMIN** (once):

```bash
railway ssh --service api -- node dist/cli/staff-create.js you@clickco.in "Your Name" SUPER_ADMIN
```

It prints a temporary password once. Sign in at the admin panel and enrol your authenticator.

---

## 7. `media-worker`

```bash
railway add --service media-worker --repo darshil320/Clicko
```

`media-worker` → Settings:
- Root directory: `/`.
- Config-as-code → Railway config file: `/apps/api/railway.worker.json`.
- Networking: no domain. It serves no HTTP.
- Resource limits: 2 vCPU, 8 GB (the config file asks for this; check that the dashboard shows it).

Connect Doppler `clickco-media-worker` → service `media-worker`, then
`railway redeploy --service media-worker --from-source`. Check the log:
`Consuming the media-export queue`. Then on Redis, check that no command was refused:

```bash
railway ssh --service redis -- sh -c 'redis-cli --tls --insecure --user default --pass "$REDIS_PASSWORD" --no-auth-warning ACL LOG 10'
```

An empty list is right. (`--insecure` only skips the certificate check of this local call.)

### 7.1 Media worker hardening

The checklist is apps/api/CLAUDE.md, "Media worker". What covers each item today:

| Item | Covered by | Status |
|---|---|---|
| No app secrets | Separate Doppler project; the worker refuses to boot with any API secret (env.ts); darktable's child gets a stripped environment (`darktableEnv`). | Done |
| Own DB role, media tables only | `clickco_media`, its own password. Same rights as the API for now. | Partly. Narrowing it needs a table review of the export path (S12). |
| Own Redis ACL user, media-export keys only | `infra/redis/start.sh`: user `media-worker`, keys `<prefix>:media-export:*` and `<prefix>:storage:uploaded:*`, no admin or dangerous commands, no pub/sub. | Done |
| Non-root | Dockerfile: `USER node`. | Done |
| No Docker socket | Railway never mounts one. | Done |
| no-new-privileges, all capabilities dropped | Railway has no setting for either. The image strips every setuid/setgid bit and the process runs as a non-root user, so it holds no capabilities and has nothing to escalate through. | Image side only |
| cgroup limits: memory and CPU | `railway.worker.json`: 2 vCPU, 8 GB (`limitOverride`). darktable's own cap is `ulimit -v` 6 GB. | Done (check the dashboard) |
| cgroup limit: pids | Railway has no setting. | **Railway cannot** |
| Read-only root filesystem | Railway has no setting. The image is ready for it: it writes only to `/tmp`. | **Railway cannot** |
| Size-limited tmpfs for `/tmp` | Railway has no tmpfs. `/tmp` is the container's own disk. | **Railway cannot** |
| Egress allow-list (only Postgres, Redis, storage) | Railway services have open outbound internet. | **Railway cannot** |
| No network for darktable's child | Needs a network namespace (a privileged step). Railway containers are unprivileged. | **Railway cannot** |
| seccomp, AppArmor/SELinux | Railway does not document or expose them. | **Unknown, not configurable** |

If the items Railway cannot do must hold at launch, run only the worker on a host where you control
`docker run`: a small VM, or any container host that supports these flags. The same image works:

```bash
docker run -d --name clickco-media-worker --restart unless-stopped \
  --read-only --tmpfs /tmp:rw,nosuid,nodev,size=2g \
  --cap-drop ALL --security-opt no-new-privileges \
  --memory 8g --cpus 2 --pids-limit 256 \
  --env-file worker.env clickco-media-worker
```

Add an egress firewall on that VM that allows only Postgres, Redis and Google's APIs. The tmpfs
counts against the 8 GB memory limit. One catch: off Railway, the worker cannot reach
`*.railway.internal`. Postgres and Redis would then need Railway's public TCP proxy, and Postgres
would need TLS turned on first. That is a bigger change: plan it as its own step.

---

## 8. Admin panel and upload portal (Vercel)

Create two projects from the same repository. Dashboard → Add New → Project → import
`darshil320/Clicko`:

| Setting | `clickco-admin` | `clickco-portal` |
|---|---|---|
| Root directory | `apps/admin` | `apps/portal` |
| Framework | Next.js | Next.js |
| Install and build commands | from `apps/admin/vercel.json` | from `apps/portal/vercel.json` |
| Node.js version | 22.x | 22.x |
| "Include files outside the root directory" | on (default) | on (default) |

Connect Doppler `clickco-admin` and `clickco-portal` (section 2) **before** the first build.
The build stops on purpose without an https `NEXT_PUBLIC_API_URL`.

What the build does: install the root and this app's workspace from the frozen lockfile, build the
shared packages, then `build:production` (`CLICKCO_DEPLOY=1 next build`).

Security headers: both apps already send them. `proxy.ts` sets a fresh nonce CSP on every page
and `next.config.ts` sends HSTS, nosniff, `no-referrer`, `X-Frame-Options: DENY`, a
Permissions-Policy and COOP/CORP. So their `vercel.json` adds **no** headers. A second CSP would be
enforced alongside the nonce one and break the pages. `src/shared/vercel-config.test.ts` in each
app keeps it that way.

---

## 9. DNS (Cloudflare)

Add each custom domain in its host first. The host shows the exact record to create.

| Name | Type | Target | Proxy |
|---|---|---|---|
| `api` | CNAME | the value Railway shows (`railway domain api.clickco.in --service api`, or `api` → Settings → Networking → Custom domain) | DNS only (grey) |
| `admin` | CNAME | the value Vercel shows (`clickco-admin` → Settings → Domains) | DNS only (grey) |
| `portal` | CNAME | the value Vercel shows (`clickco-portal` → Settings → Domains) | DNS only (grey) |

- Keep "DNS only". Railway and Vercel issue the TLS certificates and see the real client IP.
  Turning on Cloudflare's proxy for `api` means `TRUST_PROXY_HOPS=2`, or every client shares one
  rate-limit bucket.
- Add any TXT verification record the host asks for.
- If the zone has CAA records, allow `letsencrypt.org`.
- The website's own domain (`clickco.in` or `www.`) is separate: its origin must equal `PUBLIC_WEB_URL`.

---

## 10. The final URLs and the mobile apps

### 10.1 Check the URLs

These were set in section 3 with the final domains. Now that DNS works, confirm:
- `CORS_ORIGINS` lists exactly `https://admin.clickco.in` and `https://portal.clickco.in`
  (add Expo web origins only if you ship the web build of an app);
- `PUBLIC_API_URL` = `https://api.clickco.in`;
- `PUBLIC_WEB_URL` = the website's exact origin.

A change in Doppler syncs to Railway and redeploys `api`.

### 10.2 EAS (mobile builds)

Bundle ids: Client `in.clickco.client`, Pro `in.clickco.pro`. They cannot change after the first
store upload. Confirm them before step 3 below.

1. Link each app to an EAS project (once):

   ```bash
   cd apps/client && eas init
   cd ../pro && eas init
   ```

   `app.config.ts` is dynamic, so `eas init` prints a project id and asks you to add it. Paste
   `owner: '<your expo account or org>'` and `extra: { eas: { projectId: '<id>' } }` into the object
   returned by `appConfig` in each `app.config.ts`, and commit.

2. Public build variables, per app (they are inlined into the app, so never a secret):

   ```bash
   cd apps/client
   eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.clickco.in --visibility plaintext
   cd ../pro
   eas env:create --environment production --name EXPO_PUBLIC_API_URL --value https://api.clickco.in --visibility plaintext
   eas env:create --environment production --name EXPO_PUBLIC_UPLOAD_PORTAL_URL --value https://portal.clickco.in --visibility plaintext
   ```

   A production build refuses anything but https here (`assertReleaseUrls` in app.config.ts).

3. Build (from each app's folder):

   ```bash
   eas build --platform all --profile production
   ```

   The production profile uses Node 22.23.4 and Corepack (pnpm 11 from `packageManager`), store
   distribution, an Android App Bundle, and build numbers EAS keeps (`appVersionSource: remote`,
   `autoIncrement`). EAS uploads the whole repository and installs it. The root `postinstall`
   script then builds the shared packages (only when `EAS_BUILD=true`), because app.config.ts and
   the bundle import their `dist/`.

4. Submit:

   ```bash
   eas submit --platform ios --profile production --latest
   eas submit --platform android --profile production --latest
   ```

   - iOS: `eas submit` signs in to App Store Connect and creates the app record if needed.
   - Android: Google requires the **first** upload by hand. Download the `.aab` from the EAS build
     page and upload it in Play Console → Internal testing. Then create a Google service account
     for EAS (`eas credentials` → Android → Google Service Account) and later submits are automatic.
     The profile submits to the `internal` track as a draft.

There are no over-the-air updates (`expo-updates` is not installed), so `runtimeVersion` is not set.
A fix ships as a new store build.

---

## 11. Smoke checks after deploy

Run these after each first deploy, and after any deploy that touched config.

```bash
# API up, database reachable (200 and "database":"up")
curl -fsS https://api.clickco.in/health

# API security headers
curl -sI https://api.clickco.in/health | grep -i -E '^(cache-control|x-content-type-options|x-frame-options|referrer-policy):'

# CORS allows the panel and nobody else
curl -s -o /dev/null -D - -X OPTIONS https://api.clickco.in/health \
  -H 'Origin: https://admin.clickco.in' -H 'Access-Control-Request-Method: GET' | grep -i '^access-control-allow-origin'
curl -s -o /dev/null -D - -X OPTIONS https://api.clickco.in/health \
  -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET' | grep -i -c '^access-control-allow-origin'   # 0

# Exactly one CSP on the panel and the portal, and HSTS
for u in https://admin.clickco.in/sign-in https://portal.clickco.in/login; do
  echo "$u"; curl -sI "$u" | grep -i -c '^content-security-policy:'   # 1
  curl -sI "$u" | grep -i '^strict-transport-security:'
done
```

Then by hand:
- `api` logs: no `Refusing to start`, no `Could not register repeatable jobs`.
- `media-worker` logs: `Consuming the media-export queue`. Redis `ACL LOG` empty (section 7).
- Sign in to the panel as the SUPER_ADMIN. Open Today.
- Pro app: sign in a test photographer, check the OTP arrives by SMS.
- Client app: quote a booking. Pay with a Razorpay test card on staging.
- RUNBOOK.md §1.1, §4.2 and §3.2 read clean.

---

## 12. Rolling back

| Piece | How | Note |
|---|---|---|
| `api` | Railway → `api` → Deployments → a good one → Rollback. CLI: `railway redeploy --service api --commit <sha>`. | Migrations do not roll back. Every migration must work with the release before it (add first, remove later). |
| `media-worker` | Same, on `media-worker`. | Jobs wait in Redis while it is down. |
| A bad migration | Do not hand-edit tables. Ship a new migration that repairs it. Restore a backup only for data loss (RUNBOOK.md §9). | The pre-deploy stops a deploy whose migration fails; nothing is half-applied (one transaction per file). |
| `postgres` | Backups tab → restore (volume backup, or PITR if available) into a **new** service. Point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at its hostname. | RUNBOOK.md §9 first. |
| `redis` | Redeploy the previous deployment. | Redis holds no source of truth (RUNBOOK.md §4.6). |
| A secret | Doppler → the secret → history → restore. The sync redeploys the service. | Keys that seal data: RUNBOOK.md. |
| Admin, portal | Vercel → project → Deployments → a good one → Instant Rollback. CLI: `npx vercel@latest rollback <deployment-url>`. | |
| DNS | Cloudflare → put the old record back. | TTL "Auto" is 5 minutes. |
| Mobile apps | No rollback. Halt the rollout (Play Console), or remove the version from sale (App Store), and ship a fixed build. | |

---

## 13. Owner decisions still open

- Section 0: B6 (OTP SMS), provider credentials, B10 (Drive).
- Redis: keep our TLS image, or approve an env.ts exception for Railway's private network.
- PITR: accept daily backups, or move Postgres.
- Migration owner URL inside the API container (section 6): accept, or approve the code change.
- Media worker: accept the items Railway cannot enforce, or run the worker on a VM (7.1).
- `PUBLIC_WEB_URL`: `https://clickco.in` or `https://www.clickco.in`.
- Mobile: confirm the bundle ids; the store version (`0.1.0` today, probably `1.0.0` at launch);
  the export-compliance answer (`ios.config.usesNonExemptEncryption`); store names.

---

## Building the images locally

From the repository root:

```bash
docker build -f apps/api/Dockerfile -t clickco-api .
docker build -f apps/api/Dockerfile.worker -t clickco-media-worker .
docker build -t clickco-redis infra/redis
```

Run the API image against the local Postgres and Redis (`docker compose up -d postgres redis`).
Use a scratch database and a scratch queue prefix, so it never touches your local API's data or
jobs. Port 4100, because a local API usually holds 4000.

```bash
docker exec clickco-postgres-1 psql -U clickco -d clickco -c 'CREATE DATABASE clickco_docker_smoke;'
cat > /tmp/clickco-docker.env <<EOF
NODE_ENV=development
PORT=4000
DATABASE_URL=postgres://clickco:clickco_local_only@host.docker.internal:5433/clickco_docker_smoke
REDIS_URL=redis://:clickco_local_only@host.docker.internal:6380
QUEUE_PREFIX=clickco-docker-smoke
SMS_ADAPTER=console
SANDBOX_WEBHOOK_SECRET=$(openssl rand -hex 32)
JWT_ACCESS_SECRET=$(openssl rand -base64 48)
OTP_HASH_PEPPER=$(openssl rand -base64 48)
EOF
docker run --rm --env-file /tmp/clickco-docker.env clickco-api node dist/infra/db/migrate.js
docker run -d --name clickco-api-smoke -p 4100:4000 --env-file /tmp/clickco-docker.env clickco-api
curl -fsS http://localhost:4100/health
docker stop clickco-api-smoke && docker rm clickco-api-smoke
```

Clean up afterwards: drop `clickco_docker_smoke`, and delete the `clickco-docker-smoke:*` keys in
the local Redis (the scheduler registered its repeatable jobs there).

### Rehearsed locally on 4 Nov 2026

- API image: built, migrated a scratch database, `/health` 200 with the security headers, Docker
  healthcheck `healthy`, runs as `node` with no setuid files, stops on SIGTERM in under a second
  (exit 143, no SIGKILL).
- Production rehearsal on a throwaway Docker network: `postgis/postgis:16-3.4`, the role SQL of
  4.3, then the pre-deploy migration as `clickco_owner` (not a superuser) with a production env:
  all 17 migrations applied, re-run says "up to date". `infra/redis` with the certificate commands
  of 3.3: TLS only, the plain port closed, `media-worker` refused other keys, `FLUSHALL`, `KEYS`
  and `CONFIG`. The worker (`node dist/worker.js`, production env, `clickco_media`,
  `rediss://media-worker@…`, `REDIS_CA_CERT`) booted under `--read-only`, a `/tmp` tmpfs,
  `--cap-drop ALL`, `no-new-privileges` and `--pids-limit`, took a media-export job and completed it
  with no ACL denial.
- The API in production mode stopped at boot with `SMS_ADAPTER=dlt is not implemented yet`. Since
  fixed: `dlt` is the MSG91 OTP adapter and needs the `MSG91_OTP_*` values (section 0).
- Not rehearsed: a real RAW through darktable, the Drive adapter (not built), Railway, Doppler,
  Vercel and EAS themselves (no accounts yet).
