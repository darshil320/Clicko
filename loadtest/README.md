# Load tests (Sprint 12, ADR-0029 D5)

Three [k6](https://grafana.com/docs/k6/latest/) scripts and a seed script. k6 is a standalone
binary (`brew install k6`), not an npm dependency. The seed script is plain Node 22 (no pnpm, no
packages).

| Script        | What it does                                                                                                                                           | Thresholds (ADR-0029 D5)                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `upload.js`   | (a) The portal's chunked upload: session → 8 MiB parts, 4 in flight, each with its SHA-256 → complete each file → abort (so the booking can be reused) | part server time p95 < 1.5 s, p99 < 4 s · session create p95 < 1.5 s · file complete p95 < 1 s · errors < 1 %                       |
| `booking.js`  | (b) Quote → booking → pay (sandbox webhook) → confirmed; every 5th funnel cancels before paying                                                        | quote p95 < 300 ms, p99 < 800 ms · create p95 < 600 ms · pay and webhook p95 < 800 ms · paid → CONFIRMED p95 < 5 s · errors < 0.5 % |
| `delivery.js` | (c) The public delivery link: listing at `LISTING_RPS` plus `DOWNLOAD_VUS` people downloading files                                                    | listing p95 < 300 ms, p99 < 1 s · file first byte p95 < 800 ms · errors < 0.5 %                                                     |

Every script fails at once if the target is `api.clickco.in` or `/health` is not 200.

## Where to run them: the load-test stack, never staging or production

The seed needs the dev endpoints: the OTP peek (`/dev/otp`) and the payment simulator
(`/dev/payments/:id/simulate`, which signs a sandbox webhook and feeds it through the real verify →
dedupe → apply path). `apps/api/src/config/env.ts` only allows them with **`NODE_ENV=development`,
`DEV_TOOLS=on` and a database on `localhost`** (security audit L5). Staging is deployed
(`NODE_ENV=staging`), so it refuses `DEV_TOOLS=on` at boot, and that is right: we do not weaken a
staging guard to make testing easier.

So the load test runs on a **disposable stack** that is staging-sized but development-configured
(ADR-0029 D5):
1. One VM, sized like the production API (start with 4 vCPU / 8 GB). Docker Compose with
   `postgis/postgis:16`, `redis:7`, the API image and the media-worker image, all on the host
   network so the database is `localhost`. Use the same images as staging (docs/DEPLOY.md).
2. API environment, beyond the usual:

   ```
   NODE_ENV=development  DEV_TOOLS=on  DATABASE_URL=postgres://…@localhost:5432/clickco
   PAYMENT_GATEWAY=sandbox  SANDBOX_WEBHOOK_SECRET=<32+ random chars>
   SMS_ADAPTER=console  STORAGE_ADAPTER=local  STORAGE_LOCAL_ROOT=/data/storage
   JPEG_EXPORT_ADAPTER=passthrough   # or darktable + MEDIA_WORKER_ISOLATED=true on both
   QUEUE_PREFIX=loadtest  DB_POOL_MAX=<as production>
   TRUST_PROXY_HOPS=<real proxy hops + 1>   # see "Per-IP limits" below
   ```
3. `pnpm --filter @clickco/api db:migrate`, `db:seed`, `db:seed:dev` (22 demo photographers, the
   dev staff accounts).
4. Never load production data into it. Destroy it after the run.

Storage: the Google Drive adapter is not implemented yet (it throws until B10, the Shared Drive and
service account). Until it is, these tests measure the API's upload path against local disk, not
Drive's throughput or quotas. Run `upload.js` again once the Drive adapter exists.

## Seeding

```bash
export BASE_URL=https://perf-api.example        # the load-test stack
node loadtest/seed/seed.mjs clients --count 40  # 40 client accounts (OTP via the dev peek)
node loadtest/seed/seed.mjs shoots              # one live shoot per demo photographer: booked,
                                                #  paid, accepted, checked in, started
# … the booked hours must pass in real time: about 4 h (2 h minimum lead + 2 h minimum shoot)
node loadtest/seed/seed.mjs checkout            # CHECKED_OUT: uploadable
node loadtest/seed/seed.mjs deliver --count 3   # 3 of them through upload → QA → DELIVERED
node loadtest/seed/seed.mjs tokens              # fresh access tokens; run right before each k6 run
node loadtest/seed/seed.mjs status
```

- Output goes to `loadtest/.seed/` (git-ignored, files mode 0600: they hold session tokens).
  `SEED_DIR` moves it.
- `shoots` books one 2-hour BASIC shoot per demo photographer, all at the same time slot, and
  accepts each photographer's first offer. A booking nobody accepts within 4 minutes stays in
  dispatch until its deadline cancels it and flags the refund (a paid booking cannot be cancelled
  through the API yet). With the dev seed you get up to 22 shoots, so up to 22 upload VUs.
- `deliver` consumes shoots: a delivered booking can no longer be uploaded to.
- Staff QA signs in as `quality@clickco.test` with the dev seed's public password and
  authenticator secret. Override with `SEED_STAFF_EMAIL`, `SEED_STAFF_PASSWORD`,
  `SEED_STAFF_TOTP_SECRET`.
- OTP limits: at most 300 OTP texts an hour per number prefix (`+9199990`, which every seeded
  phone shares). Keep `clients --count` under 100 per hour.

## Running

```bash
node loadtest/seed/seed.mjs tokens
k6 run -e BASE_URL=$BASE_URL -e VUS=20 --summary-export loadtest/results/upload.json loadtest/upload.js
node loadtest/seed/seed.mjs tokens
k6 run -e BASE_URL=$BASE_URL -e PEAK_RPS=2 --summary-export loadtest/results/booking.json loadtest/booking.js
k6 run -e BASE_URL=$BASE_URL -e LISTING_RPS=30 --summary-export loadtest/results/delivery.json loadtest/delivery.js
```

| Variable                                    | Default                 | Meaning                                                                          |
| ------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `BASE_URL`                                  | `http://localhost:4000` | the API                                                                          |
| `SEED_DIR`                                  | `loadtest/.seed`        | where the seed files are                                                         |
| `VUS`                                       | every seeded uploader   | concurrent photographers (upload)                                                |
| `FILES_PER_SESSION` / `PARTS_PER_FILE`      | 5 / 3                   | each file is `PARTS_PER_FILE` × 8 MiB                                            |
| `COMPLETE=1`                                | off                     | complete (not abort) the last iterations: starts JPEG export                     |
| `PEAK_RPS` / `HOLD`                         | 2 / 6m                  | new booking funnels a second (5 for the stress run), and how long the peak holds |
| `PINCODES`                                  | Surat, Mumbai, Vadodara | where the bookings are                                                           |
| `LISTING_RPS` / `DOWNLOAD_VUS` / `DURATION` | 30 / 10 / 5m            | delivery test                                                                    |
- **Every run must finish within 14 minutes** (`maxDuration`): the seeded access tokens live 15
  minutes and k6 does not refresh them. Run `seed.mjs tokens` before each run.
- Results land in `loadtest/results/` (git-ignored). Copy the summary into the sprint notes.

## Per-IP limits

The API limits by client IP: 120 requests a minute per route (global), 60 quotes, 60 delivery-link
hits, 1,200 upload parts. A load test from one machine is one IP, so it would mostly measure the
limiter. Each VU therefore sends its own `X-Forwarded-For` (10.x.y.z). The API only believes it
when `TRUST_PROXY_HOPS` is one more than the real number of proxies in front of it, which is why
the load-test stack sets it that way. **Never set that on staging or production**: it would let
any caller choose their IP.

## What a failure means

- `http_req_waiting{name:part}` over target: the API's hashing and storage write are slow. Check
  CPU on the API, disk I/O, and `MEDIA_CONFIG` (apps/api/src/modules/media/media.config.ts).
- `booking_confirm_seconds` over 5 s: the outbox is behind (2 s tick, 100 events a claim). See
  docs/RUNBOOK.md "Outbox".
- 429s: the `X-Forwarded-For` trick is off (`TRUST_PROXY_HOPS`), or one VU is doing more than a
  person would.
- 5xx: search the API log for `error_report` (ADR-0029 D3), then docs/RUNBOOK.md.

## Status (4 Nov 2026)

- k6 is not installed on the development machine, so none of the k6 scripts has run yet.
- `seed.mjs clients` and `seed.mjs shoots` were run against the local API (3 clients, 3
  photographers: 1 shoot seeded; the other two bookings were not accepted in time, the first
  photographer being busy with the dry-run booking at that hour).
