# Dry runs (Sprint 12, ADR-0029 D5)

Two things live here:
1. **`run.ts`**: a script that drives one booking through every lifecycle state and prints a
   PASS/FAIL line per step. It is the smoke test before each staff session.
2. **`CHECKLIST.md`**: the 10 staff dry-run bookings, one variant each, done by people on the
   real apps and the admin panel.

## The script

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"   # Node 22 (docs/HANDOVER.md §5)
cd /Users/darshillashkari/Desktop/documents/Clickco
apps/api/node_modules/.bin/tsx scripts/dry-run/run.ts --api http://localhost:4000
```

It uses `tsx` from apps/api's devDependencies: there is nothing to install. It speaks through the
real SDKs in `packages/api-client`:
- the client: `createApiClient`;
- the photographer: `createProApiClient`;
- staff QA: `createAdminApiClient`, signed in with password and authenticator.

The portal's upload routes, the client's delivery view and the public `/d/<token>` listing have no
SDK wrapper, so `sdk.ts` calls them with the SDK's own envelope parser. The dev endpoints are used
for three things only:
- reading the OTP (`/dev/otp/:phone`);
- the payment webhook (`/dev/payments/:id/simulate`, which signs a sandbox webhook and sends it
  through the real verify → dedupe → apply path);
- the dispatch view, to see which photographer was offered the job.

| #    | Step                           | What it proves                                                                        |
| ---- | ------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | target is a dev API            | `/health` is 200; refuses `api.clickco.in`                                            |
| 2    | client signs in                | OTP request → dev peek → verify (a fresh `+91 99990 1xxxx` client each run)           |
| 3    | quote                          | the pricing engine quotes the shoot                                                   |
| 4    | create booking                 | QUOTED, with an Idempotency-Key                                                       |
| 5    | pay advance                    | order → signed webhook → CONFIRMED                                                    |
| 6    | dispatch                       | the outbox opens wave 1, and a dev-seed photographer is offered the job               |
| 7–8  | photographer signs in, accepts | ASSIGNED (an authorise-only payment is captured on acceptance)                        |
| 9–11 | en route, check-in, start      | geofence against the venue's fallback point; IN_PROGRESS                              |
| 12   | check-out                      | only once the booked hours are over (see "Real time" below)                           |
| 13   | portal upload                  | 4 files, 5 parts (one RAW is 9 MiB, so 2 parts), per-part and whole-file SHA-256      |
| 14   | JPEG export → QA               | the export job runs and the booking reaches QA                                        |
| 15   | staff QA pass                  | `quality@clickco.test` via the admin SDK → BALANCE_PENDING or DELIVERED               |
| 16   | pay balance                    | when something is due; a fully prepaid booking skips it                               |
| 17   | delivery link works            | the client's delivery view → the public listing → a RAW file's bytes match the upload |
| 18   | client reviews                 | 5/5 saved                                                                             |

Exit codes: 0 all passed · 1 a step failed · 2 bad options · 3 paused at check-out.

### Real time: check-out pauses the run

The API will not check out before the booked hours are over (`MINIMUM_DURATION_NOT_MET`), and
there is no clock to move.
- The shortest booking is 2 hours, at least 120 minutes ahead: the auto-refund lead (90) plus the
  fill window (30).
- So a full run takes about 4 hours of wall-clock time.
- The script books 125 minutes ahead, runs to IN_PROGRESS, saves its progress and stops with
  `WAIT`.

Resume after the time it prints:

```bash
apps/api/node_modules/.bin/tsx scripts/dry-run/run.ts --api http://localhost:4000 --resume
```

Or wait in the same process: `--max-wait-minutes 300`.

Progress is saved in `.dry-run-state.json` (git-ignored, mode 0600). It holds the run's session
tokens, so **delete it after the run**.

### Options

| Option                              | Default                                    |                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--api`                             | `http://localhost:4000` (or `DRY_RUN_API`) | the target                                                                                                                                                                                                  |
| `--state`                           | `.dry-run-state.json`                      | the progress file                                                                                                                                                                                           |
| `--resume`                          | off                                        | continue the saved run                                                                                                                                                                                      |
| `--max-wait-minutes`                | 0                                          | wait in-process for check-out                                                                                                                                                                               |
| `--lead-minutes`                    | 125                                        | minutes to the scheduled start. Under 3 h is the HOURS_UNDER_3 band: authorise-only, 100 % upfront, so step 16 skips. Over 48 h exercises the 50/50 advance and the balance, but check-out is two days away |
| `--hours`                           | 2                                          | the booked hours                                                                                                                                                                                            |
| `--tier`, `--category`, `--pincode` | PROFESSIONAL, FOOD, 395007                 | the shoot                                                                                                                                                                                                   |
| `--lat`, `--lng`                    | Surat centre                               | the photographer's fix. Seeded pincodes have no centroids, so the venue's fallback point is the city centre (30 km)                                                                                         |
| `--client-phone`                    | random `+9199990 1xxxx`                    |                                                                                                                                                                                                             |

Staff: `DRY_RUN_STAFF_EMAIL`, `DRY_RUN_STAFF_PASSWORD`, `DRY_RUN_STAFF_TOTP_SECRET`. The default is
the dev seed's public `quality@clickco.test` account (apps/api/CLAUDE.md).

### Where it can run

It needs the dev endpoints, which exist only with `NODE_ENV=development`, `DEV_TOOLS=on` and a
database on `localhost` (`apps/api/src/config/dev-tools.ts`). That means a local API, or the
load-test stack (`loadtest/README.md`). On staging or production, step 2 fails with
"GET /dev/otp is missing", which is the intended result.

It needs the dev seed (`pnpm --filter @clickco/api db:seed:dev`): photographers and staff.

### Last run (4 Nov 2026, local API on :4000)
Booking CLK-1008, Professional · Food · 2 h in Surat, booked 125 minutes ahead (HOURS_UNDER_3:
authorise-only, captured on acceptance). Steps 1–11 ran at 06:37 UTC and paused at check-out.
The run resumed with `--resume --max-wait-minutes 30` and finished at 10:43 UTC:

```
PASS  05 pay advance (sandbox)      2918229 paise authorised (captured on acceptance), payment.authorized; booking CONFIRMED
PASS  06 dispatch offers a pro      wave 1: 1 offered; using Hetal Patel (1.49 km)
PASS  10 check-in (geofence)        booking CHECKED_IN; 0 m vs CITY_CENTRE, verified true
PASS  12 check-out                  booking CHECKED_OUT; SLA T0 2026-11-04T10:42:56.589Z, delivery due 2026-11-06T10:42:56.589Z
PASS  13 portal upload (multipart)  4 files, 5 parts, 10354688 bytes; booking PROCESSING
PASS  14 JPEG export → QA           booking QA
PASS  15 staff QA pass (admin)      quality@clickco.test: booking BALANCE_PENDING, QA PASSED, balance due 0 paise
PASS  16 pay balance (sandbox)      nothing due (paid in full upfront); booking DELIVERED
PASS  17 delivery link works        2 links; CLK-1008 lists 2 RAW files; DRY_0002.DNG byte-identical
PASS  18 client reviews             5/5 saved
All 18 steps passed for CLK-1008.
```
