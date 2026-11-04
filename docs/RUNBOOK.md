# Clickco on-call runbook

Checked against the code on 4 Nov 2026 (`main` after `cc23afd`). If this file and the code disagree,
the code is right: fix this file. Read section 0 first; every other section stands alone.

- Deploy, rollback, environment setup, service names, opening a shell: **see docs/DEPLOY.md.**
- Placeholders: `<prefix>` = the environment's `QUEUE_PREFIX`. `<api>`, `<worker>`, `<postgres>`,
  `<redis>` = the Railway services named in docs/DEPLOY.md. The API is `https://api.clickco.in`.

---

## 0. At a glance

### 0.1 Severity

| Level | Examples | Response |
|---|---|---|
| SEV1 | API down (`/health` 503 or no answer). Postgres down. Money wrong (double charge, double payout). Personal data exposed. A dead letter on a money event. `assignment.unsafe_reported`. | Now. Tell the people affected within 1 hour (section 12). |
| SEV2 | Payment webhooks failing. Queues backing up. Sign-in failing (Redis). Uploads refused. Exports stuck. | Within 1 hour. |
| SEV3 | One booking, one payout, one alert. | Next working hours. |

People first: `assignment.unsafe_reported` and `booking.no_show_suspected` mean someone is at a
venue. Call them before you debug anything.

### 0.2 The first 5 minutes

1. `curl -sS -w '\n%{http_code}\n' https://api.clickco.in/health` (section 1).
2. Railway dashboard: are `<api>`, `<worker>`, `<postgres>`, `<redis>` running? Any crash loop?
3. Admin panel: **Alerts** (newest first) and **Today**. Note every CRITICAL from the last hour.
4. Railway logs of `<api>`: search for `error_report` (1.2).
5. Start an incident note: times in IST, what you saw, every action you take.
6. Money moving wrong? Freeze it first: no payout export, no bank file, no refund approval.
7. Go to the matching section. Restart at most once before you have read the logs.

### 0.3 Rules for touching data

- `railway connect <postgres>` (docs/DEPLOY.md) logs you in as the table **owner**: more power than
  the API has. Start every session with:
  ```sql
  SET default_transaction_read_only = on;
  SET TIME ZONE 'Asia/Kolkata';
  ```
- Never UPDATE, DELETE or TRUNCATE an append-only table: `ledger_entries`, `audit_logs`,
  `credit_notes`, `invoices`, `review_resolutions`, `booking_status_events`, `assignment_events`,
  `photographer_application_events`, `ticket_messages`, `booking_price_snapshots`,
  `notification_sends`, `call_logs`, `moderation_actions`. Triggers refuse it. Never disable a trigger.
- Money is fixed through the admin desks (audited, four-eyes), never with SQL.
- The only writes here are marked **WRITE**: re-driving an outbox event (3.4), revoking refresh
  tokens (8.2), deleting Redis counters (2.2, 11.2). For the SQL ones, turn read-only off
  (`SET default_transaction_read_only = off;`), `BEGIN`, check the row count, `COMMIT`.
- `/dev/*` routes do not exist in staging or production. They need `NODE_ENV=development`,
  `DEV_TOOLS=on` and a localhost database (`src/config/dev-tools.ts`); env.ts refuses `DEV_TOOLS=on`
  anywhere else. The admin panel's `/dev` pages will 404.

---

## 1. Health checks and logs

### 1.1 `/health`

- `GET /health` runs `SELECT 1` on Postgres with a 2-second timeout.
  - 200: `{"success":true,"data":{"status":"ok","database":"up"},"error":null}`.
  - 503: `"status":"degraded","database":"down"`, and `Database health check failed` in the log.
- It checks **Postgres only**: not Redis, queues, the outbox, storage or the media worker. A 200
  does not mean scheduled work runs. Also check the outbox (3.2) and queue schedulers (4.2).
- Redis: `redis-cli -u "$REDIS_URL" PING` gives `PONG`. Without Redis, OTP and staff sign-in answer
  503 (they fail closed); rate limits fail open.
- The media worker (`node dist/worker.js`) has no HTTP port and no health check. Judge it by its
  logs (`Consuming the media-export queue` at boot) and the `media-export` queue.

### 1.2 Where errors are logged

Everything goes to stdout: the Railway logs of `<api>` and `<worker>`. Nothing pages you.

- **`ErrorReporter`** (`apps/api/src/infra/observability/`, ADR-0029 D3) reports:
  - every unhandled HTTP error, and any 5xx answer except a deliberate 503 (`source: "http"`,
    with the method, the route **pattern** such as `/bookings/:id/pay`, the status and the
    caller's kind: USER, PHOTOGRAPHER or STAFF);
  - a BullMQ job's **last** failed attempt, a dead letter (`source: "job"`, with queue, job name,
    job id and attempts), and any worker error such as a lost Redis connection (at most once a
    minute per queue and message; every occurrence is still a log line);
  - a process crash, just before Node exits (`source: "process"`).
  The console adapter writes one line per report: Nest logger context `ErrorReporter`, then JSON
  starting `{"type":"error_report",…}` with the error name, message, a short stack and the
  context. Everything is scrubbed first: no phone, email, token, bank, KYC, address or location
  value, and never a request body or job data. **Search the logs for `error_report`.** Sentry
  replaces the console adapter once the owner approves `@sentry/node` (ADR-0029).
- Each earlier failed attempt of a job is a warning: `Job <name> (<id>) on <queue> failed
  (attempt n/m)`. It retries on its own; only the last one is an `error_report`.

| Also search for | Means |
|---|---|
| `"source":"http"` | A 500 (or 502/504) from the global exception filter. |
| `Dead letter:` / `failed on` | An outbox event gave up / a subscriber threw (section 3). |
| `Could not register repeatable jobs` | Redis was down at boot: scheduled work is **not** running (4.5). |
| `CRITICAL:` / `HIGH:` / `[OPS-ALERT` | An ops alert (section 2). |
| `Rejected a RAZORPAY webhook` | A webhook with a bad signature (section 5). |
| `JPEG export failed for` | The media worker could not export a RAW file (4.4). |
| `Invalid or missing environment variables:` | Boot refused. Names the variables, never values. |
| `Refusing to start in production` | `DATABASE_URL` is the table owner, not `clickco_api` (9.3). |
| `must not be given app secrets` | An API secret was put on `<worker>`. Remove it. |

---

## 2. Ops alerts

### 2.1 How alerts work

- An alert is a `domain_events` row with `event_type = 'ops.alert'`: `payload.severity` (MEDIUM,
  HIGH, CRITICAL) and `payload.source_event_type` (the reason). One alert per finding.
- Shown on the admin **Alerts** desk and in the **Today** count; an alert on a booking also flags it
  on the board. City-scoped staff see only their city's booking alerts. System alerts (storage, dead
  letters, payout batches) need an every-city grant.
- **Nobody is paged.** No alert goes out by WhatsApp, SMS, push or email. You see them by looking,
  or through a Railway log alert you set up on `CRITICAL:`. There is no acknowledge: alerts stay.
- `booking.needs_review` / `payment.needs_review` appear in the feed too; settle them on **Reviews**.

```sql
SELECT occurred_at, payload->>'severity' AS sev, payload->>'source_event_type' AS reason,
       aggregate_kind, aggregate_id, payload->'details' AS details
FROM domain_events
WHERE event_type = 'ops.alert' AND occurred_at > now() - interval '24 hours'
ORDER BY occurred_at DESC LIMIT 100;
-- a booking from its id:  SELECT reference, status FROM bookings WHERE id = '<id>';
```

### 2.2 Every alert

| Reason | Sev | Means | Do |
|---|---|---|---|
| `booking.no_show_suspected` | CRITICAL | No check-in 15/20 min after start. | Call the photographer (masked call), then the client. Dispatch: replacement. |
| `assignment.unsafe_reported` | CRITICAL | Photographer reported an unsafe site. | Call the photographer now. Incidents desk. |
| `sla.breached` | CRITICAL | Delivery missed (48 h; 24 h rush). | Breaches desk: attribute or waive. Remedy on Reviews. |
| `ops.dead_letter` | CRITICAL | An outbox event failed 50 times (~10 h). | Section 3. |
| `storage.full` | CRITICAL | An upload was refused: storage can't hold it. | Section 7. |
| `storage.quota_threshold` | MED/HIGH/CRIT | Drive usage crossed 60/75/90 %. | Section 7. |
| `storage.daily_ceiling_reached` | HIGH | 24-h uploads hit 85 % of 750 GB/day. New uploads refused. | 7.3. |
| `dispatch.exhausted` | HIGH | Nobody accepted the offers. | Dispatch desk: call round. Unfilled at the deadline, it refunds itself. |
| `payment.needs_review` | HIGH | Money left the happy path (`details.reason`). | Reviews desk; 5.5. |
| `booking.needs_review` | HIGH | To settle: SLA remedy, client absent, quality outcome, claim, late replacement, offline check-in. | Reviews desk. |
| `assignment.access_denied_reported` | HIGH | Venue refused entry. | Incidents desk. Pays half (ADR-0027 D5a). |
| `assignment.client_absent_reported` | HIGH | Client not there. | Incidents; settle CLIENT_NON_ATTENDANCE on Reviews. |
| `assignment.waiting_capped` | HIGH | Waiting reached its cap (T&C 3.8). | Call the client. |
| `assignment.geofence_unverified` | HIGH | Check-in location not verified. | Check the timeline; call if in doubt. |
| `assignment.offline_check_in_after_no_show` | HIGH | Offline check-in synced after a no-show. | Reviews (OFFLINE_CHECK_IN_TIME). |
| `sla.red_alert` | HIGH | 4 h before delivery is due. | QA desk: push it through. |
| `sla.milestone_missed` | HIGH | Late step: upload start 2 h, upload done 12 h, processing 18 h, QA 24 h. | Find the stuck stage (4.4). |
| `delivery.qa_failed` | HIGH | QA rejected the delivery. | QA desk. |
| `media.jpeg_export_failed` | HIGH | One RAW failed to export (one per file). | 4.4. |
| `media.integrity_mismatch` | HIGH | Weekly audit: DB, Drive, declared counts or checksums differ. | Delete nothing. Compare `details`; re-upload if files are missing. |
| `media.integrity_provider_error` | HIGH | The audit could not read Drive. | Drive API status, service account. |
| `media.reconciliation_failed` | HIGH | Upload session finished with mismatched files; session FAILED. | The photographer uploads again. |
| `payout.not_accrued` | HIGH | An outcome should have created a payout and could not. | 6.5. |
| `payout.early_resend` | HIGH | Failed transfer resent within 7 days of its first bank file. | 6.4: may pay twice. |
| `payout.withheld` | MEDIUM | Third data loss in 365 days: payout held. | 6.5. |
| `media.upload_session_idle` | MEDIUM | Upload idle 24 h; staged parts reclaimed. | Nudge the photographer. |

Log-only alerts (no database row):
- `[OPS-ALERT otp-sms-budget]`: over 3,000 OTP SMS in an hour (all OTP SMS stop for 15 min) or over
  300 to one number range. Likely SMS pumping. Only if the traffic is real, **WRITE**: delete the
  Redis key `<prefix>:otp:sms:breaker` to reopen early.
- `[OPS-ALERT staff-login]`: over 5 failed sign-ins for one staff email in 15 min. Check
  `SELECT occurred_at, after_state->>'reason' AS reason, ip_address FROM audit_logs
  WHERE action = 'staff.login_failed' ORDER BY occurred_at DESC LIMIT 20;` and call the person.

---

## 3. Outbox stuck or dead letters

### 3.1 How it works (`src/infra/outbox/outbox-publisher.ts`)

- Each state change writes a `domain_events` row in its own transaction. `outbox.publish` (every
  2 s, one at a time per API instance) delivers events to in-process subscribers.
- A tick **claims** up to 100 due events (sets `claim_token`, pushes `next_attempt_at` 10 min out:
  the lease), commits, then delivers outside any transaction. One event may take 2 minutes.
- Success sets `published_at`. Failure adds 1 to `publish_attempts`, writes `last_error`
  (`<subscriber>: <ErrorClass>`) and retries after 2 s, 4 s, 8 s … capped at 15 min.
- At 50 failures (about 10 hours) the event is **dead**: `published_at` NULL,
  `next_attempt_at = 'infinity'`, and `ops.dead_letter` raises a CRITICAL alert.
- At-least-once: a tick that dies keeps its claim until the lease ends, then the event is
  delivered again. Subscribers are written to be idempotent.

### 3.2 Diagnose (read-only)

```sql
-- 1. Is anything moving?
SELECT published_at, now() - published_at AS age
FROM domain_events WHERE published_at IS NOT NULL ORDER BY id DESC LIMIT 1;
-- 2. The backlog.
SELECT count(*) AS unpublished,
       count(*) FILTER (WHERE publish_attempts >= 50) AS dead,
       count(*) FILTER (WHERE publish_attempts BETWEEN 1 AND 49) AS retrying,
       count(*) FILTER (WHERE publish_attempts < 50
                          AND (next_attempt_at IS NULL OR next_attempt_at <= now())) AS due_now,
       count(*) FILTER (WHERE claim_token IS NOT NULL) AS claimed,
       min(occurred_at) AS oldest
FROM domain_events WHERE published_at IS NULL;
-- 3. Which subscriber is failing.
SELECT event_type, last_error, count(*) AS n, max(publish_attempts) AS tries, min(occurred_at) AS since
FROM domain_events WHERE published_at IS NULL AND publish_attempts > 0
GROUP BY 1, 2 ORDER BY n DESC;
-- 4. Dead letters.
SELECT event_id, event_type, aggregate_kind, aggregate_id, last_error, occurred_at
FROM domain_events WHERE published_at IS NULL AND publish_attempts >= 50 ORDER BY id;
```

### 3.3 Read the answer

| You see | Means | Do |
|---|---|---|
| `due_now` grows, last publish minutes old, query 3 empty | The poller is not running. | 4.2: no `outbox` scheduler → restart `<api>`. Redis down → fix Redis first. |
| One `last_error` many times | One subscriber is broken (bug or provider down). | Logs (`failed on`). Fix it or wait out the provider. They retry by themselves. No DB change. |
| `DeliveryTimeout` in `last_error` | A subscriber ran over 2 minutes. | Check the provider and DB load. It retries by itself. |
| `claimed` > 0, `next_attempt_at` in the past | A tick died holding a claim. | Nothing. The lease frees it within 10 minutes. |
| Dead letters | 50 failures. | Fix the cause (deploy), then re-drive each (3.4). |

Money events matter most: `payment.*`, `refund.*`, `credit.*`, `payout.*`, `review.settled`,
`booking.data_loss`. A dead one can mean a missing ledger posting, payout or refund. Re-drive it the
same day.

### 3.4 Re-drive an event (WRITE)

The documented replay (ADR-0012 D9): reset attempts and next attempt. The event goes to **all** its
subscribers again; they are idempotent by contract.

**A. A dead letter**, after the cause is fixed:
```sql
SET default_transaction_read_only = off;
BEGIN;
UPDATE domain_events SET publish_attempts = 0, next_attempt_at = NULL, claim_token = NULL
 WHERE event_id = '<event_id>' AND published_at IS NULL AND publish_attempts >= 50;
-- expect UPDATE 1, else ROLLBACK;
COMMIT;
SET default_transaction_read_only = on;
```
Run query 1: it should publish within seconds. If it fails again it dead-letters again (~10 h).

**B. A published `booking.processing` event** (lost JPEG export, 4.4). Its only subscriber enqueues
the export. Same wrapper as A:
```sql
UPDATE domain_events
   SET published_at = NULL, publish_attempts = 0, next_attempt_at = NULL, claim_token = NULL
 WHERE event_id = '<event_id>' AND event_type = 'booking.processing';
```
Do not un-publish any other event type without first reading all its subscribers
(`grep -rn "subscribe('<type>'" apps/api/src`).

---

## 4. BullMQ queues backing up

### 4.1 The queues (`src/infra/queues/queue-names.ts`)

| Queue | Jobs | Repeats | Per instance | Retries | If the job is lost |
|---|---|---|---|---|---|
| `outbox` | `outbox.publish` | 2 s | 1 | default | Nothing lost (events are in Postgres). |
| `dispatch` | wave expiry, deadline (delayed); `dispatch.sweep` | sweep 30 s | 4 | default | The sweep closes overdue waves and deadlines. |
| `auth` | `auth.otp-sms` | | 4 | 3, from 5 s (only timeouts, network, 408/425/429, 5xx retry) | User taps resend (codes live 5 min). A final failure is an `error_report`. |
| `onsite` | no-show check, extension expiry (delayed); `onsite.sweep` | sweep 60 s | 4 | default | Sweep re-checks no-shows; extension expiry is also checked on approval. |
| `media` | integrity audit (weekly), quota monitor (15 min), upload reaper (1 h) | yes | 2 | default | The next run. |
| `media-export` | `media.jpeg-export` | | 2 | 5, from 30 s | **Not recovered**: booking stays PROCESSING (4.4). |
| `sla` | `sla.clock-due` (delayed); `sla.sweep` | sweep 60 s | 4 | default | The sweep fires overdue clocks. |
| `checkout` | `checkout.stale-advance-sweep` | 5 min | 1 | default | The next run. |
| `notifications` | `notifications.send` | | 4 | 6, from 20 s | **Not recovered**: that message is never sent. |

- Default retry: 5 tries, exponential from 5 s. Completed jobs are deleted; the last 1,000 failed
  jobs per queue are kept.
- With `MEDIA_WORKER_ISOLATED=true` (required for darktable when deployed) only `<worker>` consumes
  `media-export`. The API consumes the rest and registers every repeatable job, **at boot only**.

### 4.2 Count jobs with redis-cli

Keys are `<prefix>:<queue>:<kind>`: `wait`, `active` are lists; `delayed`, `prioritized`, `failed`,
`repeat` (schedulers) are sorted sets. `railway connect <redis>` or a local `redis-cli` (add `--tls`
if asked).
```bash
P='<prefix>'
for q in outbox dispatch auth onsite media media-export sla checkout notifications; do
  printf '%-14s wait=%s active=%s delayed=%s failed=%s schedulers=%s\n' "$q" \
    "$(redis-cli -u "$REDIS_URL" LLEN $P:$q:wait)"    "$(redis-cli -u "$REDIS_URL" LLEN $P:$q:active)" \
    "$(redis-cli -u "$REDIS_URL" ZCARD $P:$q:delayed)" "$(redis-cli -u "$REDIS_URL" ZCARD $P:$q:failed)" \
    "$(redis-cli -u "$REDIS_URL" ZCARD $P:$q:repeat)"
done
```
Healthy: schedulers `outbox` 1, `dispatch` 1, `onsite` 1, `media` 3, `sla` 1, `checkout` 1, others 0;
`wait` near 0. Growing `wait`: workers not keeping up or not running. Growing `failed`: a processor
keeps throwing (logs: `error_report` with `"source":"job"`).

### 4.3 List and retry failed jobs

From `apps/api` in a checkout with `node_modules`, with the production `REDIS_URL` and
`QUEUE_PREFIX` exported:
```bash
node -e '
const { Queue } = require("bullmq"); const IORedis = require("ioredis");
const [queue, action, jobId] = process.argv.slice(1);
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const q = new Queue(queue, { connection, prefix: process.env.QUEUE_PREFIX });
(async () => {
  if (action === "counts") console.log(await q.getJobCounts());
  if (action === "failed") for (const j of await q.getFailed(0, 19))
    console.log(j.id, j.name, "tries=" + j.attemptsMade, j.failedReason);
  if (action === "retry") { const j = await q.getJob(jobId);
    if (!j) console.log("no such job"); else { await j.retry(); console.log("retried", jobId); } }
  await q.close(); await connection.quit();
})();' <queue> counts|failed|retry [jobId]
```
Retrying a failed job is safe on every queue: processors check state before acting.

### 4.4 A booking stuck in PROCESSING (JPEG export)

1. Find them:
   ```sql
   SELECT b.id, b.reference, max(e.occurred_at) AS processing_since
   FROM bookings b JOIN booking_status_events e ON e.booking_id = b.id AND e.to_status = 'PROCESSING'
   WHERE b.status = 'PROCESSING' GROUP BY b.id, b.reference
   HAVING max(e.occurred_at) < now() - interval '1 hour' ORDER BY processing_since;
   ```
2. Is `<worker>` up? If not, jobs wait safely in `media-export:wait`. Start it.
3. `… media-export failed`: job ids are `jpeg-export-<booking id>`. The `media.jpeg_export_failed`
   alerts for that booking name the file and the error.
4. Fix the cause (darktable, a corrupt RAW, Drive), then `… media-export retry jpeg-export-<id>`. It
   re-tries only the RAWs not yet exported.
5. No job at all (Redis lost)? Re-drive the booking's event (3.4 B). A failed job with the same id
   blocks a re-add, so retry that one instead.
   ```sql
   SELECT event_id, published_at FROM domain_events
   WHERE event_type = 'booking.processing' AND aggregate_id = '<booking id>' ORDER BY id DESC LIMIT 1;
   ```

### 4.5 Scaling, draining, boot problems

- **More API instances:** each runs a worker per queue (not `media-export` when isolated). Parallel
  outbox ticks are safe (claim tokens, `SKIP LOCKED`). Keep `instances × DB_POOL_MAX` (default 20)
  plus the worker's pool well under `SHOW max_connections;`. `QUEUE_WORKERS=off` is test-only.
- **More exports:** add `<worker>` replicas (2 CPU-bound exports each).
- **Never drain or obliterate a queue.** Exports and messages are not recovered, and obliterate also
  deletes the schedulers. **Never delete `<prefix>:*` in bulk**: the prefix also holds staff
  lockouts, OTP limits, the webhook limiter and the Drive upload budget.
- `Could not register repeatable jobs` at boot: fix Redis, then restart `<api>`.

### 4.6 Redis is lost or flushed

Redis is not the source of truth: money, bookings and events are in Postgres. Lost with Redis:
- every waiting, delayed and failed job (4.1 says which come back by themselves);
- the repeatable schedules: **restart `<api>` and `<worker>`** to re-register them;
- staff sign-in challenges and lockouts, OTP counters and the SMS breaker, webhook bad-signature
  counters, the Today cache, KYC view links (5 min);
- the rolling 24-hour Drive upload count. It restarts at zero, so the 85 % refusal can let uploads
  through that Drive then rejects. Watch section 7 for a day.

Afterwards run 4.2, 3.2, 4.4 step 1, and check messages sent during the gap:
```sql
SELECT channel, status, error_code, count(*) FROM notification_sends
WHERE created_at > now() - interval '2 hours' GROUP BY 1, 2, 3 ORDER BY 4 DESC;
```

---

## 5. Payment webhook failures

### 5.1 How it works (`modules/checkout/payment-webhooks.controller.ts`)

- Razorpay posts to `https://api.clickco.in/payments/webhooks/razorpay`. Trust comes only from
  `X-Razorpay-Signature` (HMAC-SHA256 of the raw body under `RAZORPAY_WEBHOOK_SECRET`). One secret;
  no previous secret is accepted.
- Bad signature: 400, counted per hour in `payment_webhook_rejections` (no payload kept). After 10
  bad ones from an IP in 15 min, that IP's unverified requests get 429. Valid ones are never limited.
- Valid: deduped in `payment_webhook_events`, applied in one transaction, answered 200 (duplicates
  too, so Razorpay stops).
- Processing error: 500, `processed_at` stays NULL, `processing_error` set. **Razorpay's retry is the
  only re-processing.** Clickco never polls Razorpay for payment status.
- Razorpay retries for a limited time and can disable a webhook that keeps failing. Check the
  current policy and the webhook's status in the Razorpay dashboard.

### 5.2 Diagnose (read-only)

```sql
SELECT max(received_at) FROM payment_webhook_events;                -- any arriving?
SELECT provider, bucket_start, rejected_count, last_received_at      -- bad signatures per hour
FROM payment_webhook_rejections WHERE bucket_start > now() - interval '48 hours'
ORDER BY bucket_start DESC;
SELECT id, event_type, received_at, processing_error                -- failed: awaiting a retry
FROM payment_webhook_events WHERE processed_at IS NULL ORDER BY received_at DESC LIMIT 50;
SELECT id, event_type, received_at, processing_error                -- applied, flagged for a human
FROM payment_webhook_events
WHERE processed_at IS NOT NULL AND processing_error IS NOT NULL
  AND received_at > now() - interval '7 days' ORDER BY received_at DESC;
```

### 5.3 Why it is urgent

An unpaid booking waits in ADVANCE_PENDING for its webhook. `checkout.stale-advance-sweep` (every
5 min) cancels it once quote expiry + 30 minutes has passed. A later webhook books the money and
raises `payment.needs_review` (`CAPTURED_WHILE_CANCELLED_CLIENT` or `CAPTURED_AFTER_PAYMENT_WINDOW`):
that client now needs a refund. Every hour of broken webhooks turns paid bookings into refunds.

### 5.4 Cases

- **Bad signatures after a secret change** (rejections climb, no new verified rows):
  1. Razorpay Dashboard → Webhooks: read or set the secret (8.8).
  2. Make Doppler's `RAZORPAY_WEBHOOK_SECRET` match exactly. Restart `<api>`.
  3. Watch `max(received_at)` move and rejections stop. Re-enable the webhook if Razorpay disabled it.
- **Our API down or erroring** (5xx in Razorpay's delivery log): fix the API; Razorpay retries. The
  "awaiting a retry" list should drain to empty.
- **Razorpay outage:** nothing to fix here. Afterwards run 5.2 and work the Reviews desk. Ask
  Razorpay to re-send events that never arrived (12.4).
- **Signed but malformed** (`processing_error` starts `MALFORMED`): it got 200, so it is never
  retried. Look the payment up in Razorpay and settle it from the Reviews desk.

### 5.5 Money captured on a cancelled booking (and other reviews)

Reasons: `AMOUNT_MISMATCH`, `SECOND_CAPTURE_ON_<status>`, `CAPTURED_AFTER_PAYMENT_WINDOW`,
`CAPTURED_WHILE_<status>`, `BALANCE_CAPTURED_WHILE_<status>`, `CAPTURED_AFTER_RELEASE`,
`CAPTURED_AT_RELEASE`, `HELD_PAYMENT_CAPTURED_WHILE_<status>`, `AUTHORISED_WHILE_<status>`,
`REFUND_AMOUNT_MISMATCH`, `REFUND_WEBHOOK_UNMATCHED`.
1. Reviews desk → the item. It suggests refund, credit, charge or no action, and says why.
2. One person requests the refund, another approves it (above the QM ceiling with a fresh code).
   Never refund from the Razorpay dashboard: the ledger would not know.
3. Settling closes the review. The alert stays in the feed.

---

## 6. Payout gone wrong

### 6.1 The lifecycle (ADR-0026 D3; ADR-0027 D6a H2, D5a)

1. **PENDING**: accrued, due 3 days after the outcome. (**WITHHELD**: held back, 6.5.)
2. **Draft batch** of everything due (Mondays; off-cycle allowed). Only a draft can be discarded.
   A draft from an earlier month is stale: discard and remake it.
3. **Export** (code): amounts lock, vendor invoices, ledger credit. Each transfer gets a reference
   (`<batch ref>001`, `002` …) and becomes **APPROVED**.
4. **Bank file** (code): each transfer goes in exactly one file, becomes **PROCESSING**, and records
   who made the file. Asking again answers 409 `NOTHING_NEW`. Upload the file at the bank.
5. **Mark paid** (code, the bank's UTR) → **PAID**. A UTR belongs to one transfer (`UTR_IN_USE`;
   two exclusion constraints).
6. Or **Mark failed** (code, the bank's return reference) → **FAILED**, then **Send again** (code) →
   APPROVED under a new reference (`…R1`, `…R2`) for the next bank file.

- Payouts desk: FINANCE and SUPER_ADMIN only. Every step needs a fresh authenticator code.
- **Mark failed and Send again are maker–checker:** never by whoever made that bank file (403
  `SECOND_PERSON_REQUIRED`). You need a second FINANCE or SUPER_ADMIN. Have one before payday.

### 6.2 Look at a batch (read-only)

```sql
SELECT pb.batch_ref, pb.status AS batch_status, p.photographer_id, p.status,
       p.provider_payout_id AS transfer_ref, right(p.utr, 4) AS utr_last4, p.net_paise,
       p.bank_file_by, p.bank_file_at, p.first_bank_file_at, p.failure_reference, p.failed_at, p.paid_at
FROM payouts p JOIN payout_batches pb ON pb.id = p.batch_id
WHERE pb.batch_ref = '<batch ref>' ORDER BY p.photographer_id, p.id;
```

### 6.3 The bank returned a transfer

1. Get the bank's return or rejection reference (6–40 letters, digits, `/`, `-`) and what the bank
   said. No account numbers: the form refuses them.
2. A second finance person (not the bank-file maker): batch page → transfer → **Mark failed**.
3. Fix the cause (usually bank details). The photographer updates them; ops verifies the account.
   Send again refuses an unverified account (`NO_VERIFIED_BANK`).
4. The second person: **Send again**. Make the next bank file, upload it, mark paid with the new UTR.

### 6.4 `payout.early_resend` (HIGH)

A failed transfer was sent again within 7 days of its first bank file. A "returned" NEFT can still
land late: the photographer may be paid twice.
1. Before uploading the new file, check the bank statement for the original reference (no `R1`) and
   the return reference in the alert's `details.bank_reference`.
2. If the bank has not confirmed the return in writing, hold that line back until it does.
3. If the original did pay: do not upload the resend line. Clickco has no "cancel a resend" (gap).
   Note it and get a code fix before the next batch.

### 6.5 Other payout problems

| Problem | Do |
|---|---|
| Marked paid by mistake, wrong UTR, or a PAID transfer bounced | No undo: mark failed only accepts PROCESSING and a UTR cannot be edited. No SQL (the ledger is append-only and the paid posting exists). Record it, talk to the bank, get a code fix (gap). |
| `payout.withheld` (MEDIUM) | Third data loss in 365 days (DOMAIN section 2, G-13). Leave it, or Payouts → **Held back** → **Release** (code + note, audited). It returns to PENDING and joins the next batch. |
| `payout.not_accrued` (HIGH) | No payout row exists. `details.why`: `the booking is <status>`, `the booking was never checked out` or `no completed assignment`. A developer must look. Never insert a payout by hand. |
| A bank file made but never uploaded (lost or wrong) | It cannot be downloaded again. A second finance person marks each transfer failed with a reference you can quote to the bank (e.g. `NOTSENT-20261214`), then sends it again into a new file. Incident (gap). |

---

## 7. Storage quota (Drive)

### 7.1 The numbers (ADR-0001, ADR-0014 D5, `modules/media/media.config.ts`)

- Launch storage: a 5 TB Google Shared Drive. Drive also caps uploads at about **750 GB per day**.
  That cannot be engineered around; a sustained 18 events a day starts the R2 migration (ADR-0001).
- `media.quota-monitor` (every 15 min) writes `storage_quota_samples` and alerts on crossing 60 %
  (MEDIUM), 75 % (HIGH), 90 % (CRITICAL). Crossings only.
- New upload sessions are refused when 24-hour uploads plus the new session pass **85 %** of the
  daily cap (HIGH alert), or when the drive cannot hold it (CRITICAL). Open sessions' remaining
  bytes count against both. The 24-hour count lives in Redis (4.6).
- Retention deletes permanently (no trash): RAW 7 days, JPEG/video 30 days after delivery (T&C 5.4),
  driven by SLA retention clocks. If `sla` is not running (4.2), nothing is purged.
- `media.upload-reaper` (hourly) reclaims staged parts of sessions idle 24 hours.

### 7.2 Check (read-only)

```sql
SELECT sampled_at, adapter, round(100.0 * used_bytes / nullif(limit_bytes, 0), 1) AS used_pct,
       pg_size_pretty(used_bytes) AS used, pg_size_pretty(limit_bytes) AS size,
       round(100.0 * daily_uploaded_bytes / nullif(daily_limit_bytes, 0), 1) AS day_pct
FROM storage_quota_samples ORDER BY sampled_at DESC LIMIT 8;
```
No sample in the last 30 minutes: the `media` queue is not running (section 4).

### 7.3 Daily ceiling reached (uploads refused)

1. It clears by itself as old hours leave the window. Watch `day_pct` fall.
2. Tell photographers with pending uploads to keep their cards and upload after <time> (12.3).
3. SLA clocks keep counting. Waive breaches caused by this on the Breaches desk.
4. Raising a limit does not help: Drive refuses the bytes anyway.

### 7.4 Usage at 75–90 % or full

1. Check retention runs: `sla` scheduler present (4.2), no dead letters (3.2).
2. Never delete files by hand in Drive: `media_assets` rows would point at missing files, downloads
   fail, and the integrity audit flags mismatches.
3. More space is a Google Workspace purchase [OWNER]. There is no emergency purge tool (gap).
4. At 90 %: start the R2 migration (ADR-0001).

---

## 8. Rotating secrets

- The API reads env once at boot. Change the value in Doppler, let it sync to Railway, restart
  **every** `<api>` instance (docs/DEPLOY.md).
- Never put any of these on `<worker>`; deployed, it refuses to boot if it sees one.
- Generate with `openssl rand -base64 32` unless stated. Boot refuses JWT = OTP pepper,
  DELIVERY_LINK_KEY = JWT, BANK_ACCOUNT_KEY = STAFF_TOTP_KEY, and weak or placeholder values.
- Keep old values in Doppler history: a restored backup may need them (9.3).

| Secret | Overlap? | What breaks | Re-seal? |
|---|---|---|---|
| `JWT_ACCESS_SECRET` | No | Access tokens (15 min). Apps refresh silently. | Not needed |
| `OTP_HASH_PEPPER` | No | OTP codes in flight (5 min), queued OTP SMS. | Not needed |
| `STAFF_TOTP_KEY` | No | **Every staff authenticator**: sign-in and step-up. | **None: all re-enrol** |
| `BANK_ACCOUNT_KEY` | One previous key | Nothing at once. | **None (gap)** |
| `DELIVERY_LINK_KEY` | No | Old links still work, but the API can't show them. | **None (gap)** |
| `EXOTEL_WEBHOOK_SECRET` | `_PREVIOUS` | Nothing, done in order. | Not needed |
| `RAZORPAY_WEBHOOK_SECRET` | No | Webhooks fail until both sides match. | Not needed |

### 8.1 `JWT_ACCESS_SECRET`

Signs access tokens only (15 min). Refresh tokens are random values stored as sha256 in
`refresh_tokens` and do not use this key. After rotation every access token gets 401; the apps,
panel and portal refresh once on 401 and carry on. **Nobody is signed out.**
1. Generate, set in Doppler, restart all `<api>` instances together (a mix bounces tokens).
2. If refresh tokens may also have leaked (a database copy), also do 8.2.

### 8.2 Sign everyone out (WRITE, real compromise only)

```sql
SET default_transaction_read_only = off;
BEGIN; UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL; COMMIT;
```
Everyone signs in again. Clients and photographers use OTP SMS, so a mass sign-in can hit the
3,000-an-hour SMS budget (2.2). Do it in a quiet hour.

### 8.3 `OTP_HASH_PEPPER`

Hashes OTP codes (bound to challenge and phone) and encrypts queued OTP SMS jobs. After rotation,
codes from the last 5 minutes fail (the user taps resend) and queued OTP SMS cannot be decrypted
(they fail and drop). Nothing else uses it. Generate, set, restart in a quiet hour.

### 8.4 `STAFF_TOTP_KEY`

AES-256-GCM key for `staff_users.totp_secret`. One key: no version, no previous key, **no re-seal**.
After rotation no stored authenticator opens: the code step of sign-in fails (a 500), and so does
every step-up (refunds, payouts, staff admin). **Every staff member enrols again.** Rotate only if
the key leaked.
1. Tell staff. Pick a quiet hour with no payout or refund work in flight.
2. New key (`openssl rand -base64 32`, decodes to 32 bytes). Set it. Restart `<api>`.
3. Break-glass (11.3): `staff:create <new email> "<name>" SUPER_ADMIN`. Sign in, choose a password,
   enrol (sealed with the new key).
4. Staff desk → each person → **Reset authenticator** (your code; audited; ends their sessions).
   They enrol at their next sign-in. Do your old account too, then deactivate the break-glass one.
5. Until someone enrols, whoever holds their password enrols the authenticator. If passwords may
   have leaked too, also **Reset password** for each person.

### 8.5 `BANK_ACCOUNT_KEY` (+ `_VERSION`, `_PREVIOUS`)

Seals `photographer_bank_accounts.account_number_enc`. Byte 0 of each value is its key version. New
numbers use the current key; old ones open with the key their byte names. `BANK_ACCOUNT_KEY_PREVIOUS`
holds **one** older key as `<version>:<base64 key>`. There is **no re-seal job** (gap): old numbers
stay under the old key until the photographer saves new bank details. A rotation does not protect
numbers already sealed with a leaked key, and the previous key can't be dropped while rows use it.
1. Rows per key version:
   ```sql
   SELECT get_byte(account_number_enc, 0) AS key_version, count(*)
   FROM photographer_bank_accounts GROUP BY 1 ORDER BY 1;
   ```
2. `_PREVIOUS` already set and its version still has rows? **Stop.** A second rotation makes those
   numbers unreadable and their bank files fail. Get a re-seal job written first.
3. Else set `BANK_ACCOUNT_KEY_PREVIOUS=<current version>:<current key>`, a new `BANK_ACCOUNT_KEY`,
   and `BANK_ACCOUNT_KEY_VERSION=<current + 1>` (2–255; default 2). Restart `<api>`.
4. Only the bank file opens account numbers, so there is no dry run. A missing key shows there as
   409 `BANK_DETAILS_UNREADABLE` naming the photographer: put the old key back from Doppler history.

### 8.6 `DELIVERY_LINK_KEY`

A `/d/<token>` token is HMAC-SHA256 of the link id under this key. Only the token's sha256 is stored,
and links are looked up by it. After rotation:
- **links already sent keep working** until they expire or are revoked (rotation revokes nothing);
- the API can no longer re-derive their tokens: QA and delivery views show no link for them, and a
  DELIVERED message for an older link is skipped;
- new links work normally.

The key alone is of little use without link ids (database). After a database leak, rotation does
not help old links; they would need revoking, and there is no bulk revoke or re-issue (gap).
Generate (32+ characters), set, restart. Expect clients asking where their link went.

### 8.7 `EXOTEL_WEBHOOK_SECRET` (+ `_PREVIOUS`)

The secret is part of the URL `<PUBLIC_API_URL>/webhooks/exotel/call-status/<secret>`, which Clickco
sends with every call. Current and previous are both accepted; a wrong one gets 404.
1. `openssl rand -hex 32`. Set `EXOTEL_WEBHOOK_SECRET_PREVIOUS=<old>`, `EXOTEL_WEBHOOK_SECRET=<new>`.
   Restart. New calls report to the new URL; calls already running still use the old one.
2. After a day (calls are cut at 30 min), remove `_PREVIOUS` and restart.
3. Make sure logs and proxies redact the path segment after `/call-status/`.

### 8.8 `RAZORPAY_WEBHOOK_SECRET`

One secret, no overlap: during the switch webhooks get 400 and Razorpay retries them.
1. `openssl rand -hex 24` (16+ characters).
2. Razorpay Dashboard → Webhooks → edit → set it. Save.
3. **Immediately** set the same value in Doppler and restart `<api>`. Keep the gap to minutes.
4. 5.2: new verified rows, rejections stop, failures drain, webhook still Active.

---

## 9. Restoring a backup

### 9.1 What exists

Railway Postgres with daily backups and point-in-time recovery (ADR-0008). Confirm in the Railway
dashboard that both are on. Without PITR the last daily backup is the restore point (up to 24 h
lost). No restore drill has been done (gap). Redis is not backed up and needs no backup (4.6).

### 9.2 Before

1. SEV1. Choose the restore point; write it in IST and UTC.
2. Stop `<api>`, then `<worker>` (section 10). Razorpay webhooks fail and are retried later: good.
3. Snapshot the current state first, even if broken.
4. Restore into a **new** database where possible. Never overwrite the only copy. Never TRUNCATE to
   "make room": append-only tables refuse it, rightly. Restore into an empty database.

### 9.3 After, before starting the API

1. Checks:
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'postgis';
   SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN ('clickco_app', 'clickco_api');
   SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1;  -- today 0018_outbox_claim_token.sql
   SELECT max(occurred_at) FROM domain_events;                     -- the real restore point
   ```
2. Roles are cluster-wide. A volume or PITR restore keeps them; a `pg_dump` restore into a new server
   does not. Then, as the owner: `pnpm --filter @clickco/api db:migrate` with
   `MIGRATION_DATABASE_URL` = owner (re-runnable; creates `clickco_app`), then
   `CREATE ROLE clickco_api LOGIN PASSWORD '<new secret>' IN ROLE clickco_app;` (apps/api/CLAUDE.md).
3. `DATABASE_URL` must use `clickco_api`. The API refuses to boot as the owner.
4. Keys: restored rows are sealed with the keys current at the restore point. `STAFF_TOTP_KEY`,
   `BANK_ACCOUNT_KEY` (+ previous) and `DELIVERY_LINK_KEY` must be those; restore old values from
   Doppler history if you rotated since.
5. Point the services at it (docs/DEPLOY.md). Start `<api>`, then `<worker>`. Run 1.1, 4.2, 3.2.

### 9.4 Reconcile what was lost (everything after the restore point)

- **Payouts first.** A bank file made after the point may already be at the bank while the database
  thinks those transfers are unpaid. **No bank file** until finance has matched the bank statement
  against the restored payouts, or you pay twice.
- **Payments.** Razorpay holds captures you no longer have. Webhooks it still retries re-apply by
  themselves. List the rest from Razorpay, match by order id against `payments.provider_order_id`,
  and ask Razorpay to re-send them (12.4). Never book money by SQL.
- **Uploads** after the point have no `media_assets` rows; the weekly audit flags them.
  Photographers upload again. Never delete Drive files by hand.
- **Bookings and accounts** made after the point are gone (comms, 12.2). **Sessions** issued after it
  are unknown: those people sign in again (watch the SMS budget).
- **Redis** still holds jobs for rows that may not exist. Processors check state and skip.

---

## 10. Taking the API down safely

### 10.1 What happens on SIGTERM

`main.ts` calls `enableShutdownHooks()`:
1. Nest stops taking HTTP requests and runs the shutdown hooks.
2. Queue workers wait for repeatable-job registration, then close: no new jobs; running jobs finish.
3. Queues and Redis close; the Postgres pool closes (5 s timeout).

If the platform kills the process first:
- an outbox tick's events come back when the 10-minute lease ends (at-least-once, idempotent);
- a running BullMQ job is stalled and re-run by another worker after about 30 s (twice stalled =
  failed: retry it, 4.3);
- delayed timers stay in Redis; sweeps catch late ones.

`<worker>` is separate. Stopping `<api>` does not stop exports; stopping `<worker>` only pauses them
(they wait in `media-export:wait`).

### 10.2 Planned downtime

There is no maintenance mode and no "pause bookings" switch (gap). Stopping `<api>` is the lever.
1. Quiet hour: no shoots in progress (Today, Dispatch), no payout export or refund in flight.
2. Warn photographers with shoots in the window (12.3).
3. Stop `<api>`. Leave `<worker>` running unless the work needs it stopped.
4. While down: apps, panel and portal show error/offline states and nobody can sign in; the Pro app
   queues on-site actions offline and syncs later (ADR-0024); Razorpay retries webhooks; SLA clocks
   keep counting.
5. Start `<api>`. Check 1.1, 4.2 (schedulers back), 3.2 (outbox drains), Alerts.
6. Afterwards: waive downtime breaches (Breaches desk), review no-show alerts for shoots in the
   window, settle `assignment.offline_check_in_after_no_show` items (Reviews).

Rolling restarts and several instances are safe: claims, `SKIP LOCKED` and job-id dedupe.

---

## 11. Staff access: lockouts and the first SUPER_ADMIN

### 11.1 The rules (`modules/admin/auth/`)

- Password, then authenticator code. A challenge lives 5 minutes. A temporary password, 72 hours.
- 5 wrong passwords for one email from one network (IPv6 per /64), or 20 from one network, in
  15 minutes: 429 "Try again in 15 minutes". Across many networks: only slowed, and alerted.
- 5 wrong codes end the challenge; 10 per account in 15 minutes: 429 at the password step.
- Development-seed accounts (`@clickco.test`) are refused when deployed. All state is in Redis:
  Redis down means staff sign-in answers 503.

### 11.2 Unlock someone

There is no "unlock" button. In order:
1. **Wait 15 minutes.** The counters expire.
2. **Forgot the password:** a SUPER_ADMIN → Staff → **Reset password** (code). Shows a temporary
   password once, ends their sessions, clears their password counters (not the code counter).
3. **Lost the authenticator:** Staff → **Reset authenticator** (code). They enrol at next sign-in.
4. **Clear the counters in Redis (WRITE, counters only).** Emails are hashed:
   ```bash
   P='<prefix>'
   H=$(printf '%s' 'person@example.com' | tr '[:upper:]' '[:lower:]' | shasum -a 256 | cut -d' ' -f1)
   redis-cli -u "$REDIS_URL" --scan --pattern "$P:staff-auth:fail:email*:$H*"   # list first
   redis-cli -u "$REDIS_URL" DEL "$P:staff-auth:fail:email:$H"                   # + each email-ip key listed
   redis-cli -u "$REDIS_URL" DEL "$P:staff-auth:fail:totp:<staff id>"            # wrong-code counter
   ```
   A whole office network locked: `DEL "$P:staff-auth:fail:ip:<ip>/32"`. Staff id:
   `SELECT id, is_active, totp_secret IS NOT NULL AS enrolled FROM staff_users WHERE lower(email) = lower('<email>');`

### 11.3 First SUPER_ADMIN, or the only one is locked out (break-glass)

```bash
pnpm --filter @clickco/api staff:create <email> "<full name>" SUPER_ADMIN
```
- Run it where the API's full production env is loaded and Postgres is reachable (docs/DEPLOY.md).
  It validates the whole env and runs `src/cli/staff-create.ts` with tsx: it needs the repo source,
  not only `dist`.
- It prints a temporary password **once** (72 hours). Audited as SYSTEM `staff.create`. An existing
  email is refused ("already exists; nothing changed"): use another address.
- Sign in, choose a password, enrol. Fix the old account from the Staff desk, then deactivate the
  break-glass account if not needed.
- Keep two people able to sign in as SUPER_ADMIN or FINANCE. Payouts need a second person (6.1).

---

## 12. Incident comms

### 12.1 Who and how

- **No broadcast exists.** WhatsApp/SMS templates cover lifecycle events only (confirmed, assigned,
  on the way, checked in/out, balance due, delivered, refund, credit, ticket received; Pro: new
  offer, payout paid/held/released). Incident messages go by hand from the support phone or email.
- Find who is affected with SQL (bookings by status and time). Never paste phone numbers, emails or
  bank details into logs, tickets or chat. A booking reference is not proof of identity.
- Delivery late because of us: tell the client within 24 hours of the shoot and deliver within
  7 days at most (T&C 5.3).
- Grievances (T&C section 12): acknowledge within **48 hours**, resolve within **30 days**:
  ```sql
  SELECT reference, category, is_grievance, status, ack_due_at, resolve_due_at FROM support_tickets
  WHERE (acknowledged_at IS NULL AND ack_due_at < now() + interval '12 hours')
     OR (resolved_at IS NULL AND resolve_due_at < now() + interval '3 days')
  ORDER BY ack_due_at;
  ```
- Grievance Officer: **[OWNER: name, email, phone]** (not named yet, OD-06/09).
- Personal data may have leaked: CERT-In expects a report within 6 hours of noticing a reportable
  incident, and data-protection notice duties may apply. Call **[OWNER: lawyer contact]**.
- Razorpay: support ticket from the dashboard (12.4).

### 12.2 Client: booking affected

> Hi <first name>, this is Clickco support. We had a technical problem on <date> from <time> to
> <time> IST that affected your booking <REF>. <One line: what happened to it.> Next: <we deliver by
> … / your refund of ₹… is on its way, 5–7 working days / nothing, your booking stands>. We are
> sorry. Reply here with any question.

### 12.3 Photographer

> Hi <name>, Clickco ops. Our system is down from <time> IST, expected back by <time>. On a shoot?
> Keep shooting: the Pro app saves check-in and check-out and sends them when we are back. Note your
> arrival and finish times. Urgent: call <ops phone>.

> Hi <name>, uploads are paused until about <time> IST because of a storage limit. Please keep your
> cards safe and upload after that. Your job is not affected.

> Hi <name>, your payout for <period> is delayed by a bank problem on our side. New date: <date>.
> Nothing is lost. We will message you when it is sent.

### 12.4 Razorpay support

> Merchant ID <id>. Between <start> and <end> IST our webhook https://api.clickco.in/payments/webhooks/razorpay
> <returned 5xx / returned 400 after a secret change / received nothing>. Fixed as of <time>. Please
> re-send all payment and refund webhook events for that window and confirm webhook <id> is active.

### 12.5 Grievance acknowledgement (within 48 hours)

> Dear <name>, we have received your complaint <TKT-…> of <date>. Our Grievance Officer,
> <[OWNER] name>, will reply within 30 days of receipt, sooner if we can. Contact: <[OWNER] email>.

---

## 13. Known gaps found while writing this

What an operator needs that the code does not do (4 Nov 2026):

1. **Uploads cannot work in production yet:** the Google Drive adapter is a skeleton that throws
   (PLAN B10). OTP SMS now has its MSG91 adapter (`SMS_ADAPTER=dlt`, `256f228`); it sends once
   the DLT entity, header and OTP template are approved (PLAN B6).
2. **Nobody is paged:** alerts are rows and a feed; no message to staff, no acknowledge or close.
3. **`/health` checks Postgres only;** the media worker has no health check at all.
4. **No ops tooling** for the outbox or queues: re-drive is raw SQL, failed jobs need the 4.3 snippet.
5. **Lost jobs not recovered:** `media-export` (booking stuck in PROCESSING), `notifications.send`.
   Repeatable jobs register only at boot, so a Redis flush stops scheduled work until a restart.
6. **Payments rely on webhooks alone** (no Razorpay polling or reconciliation); the webhook secret
   has no previous-secret overlap for rotation.
7. **Key rotation:** `STAFF_TOTP_KEY` has no versioning or re-seal (everyone re-enrols; a 500, not a
   clear error); `BANK_ACCOUNT_KEY` has no re-seal job and one previous slot; `DELIVERY_LINK_KEY`
   rotation neither revokes nor re-issues old links, and there is no bulk revoke.
8. **Payout corrections:** no undo of a wrong mark-paid or UTR, no failing a bounced PAID transfer,
   no "cancel a resend", no re-download of a lost bank file.
9. **Maker–checker with one person:** fixing a transfer from your own bank file needs a second
   FINANCE/SUPER_ADMIN account. Create it before the first payday.
10. **No maintenance mode,** "pause bookings" switch, staff "unlock" action, or broadcast message.
    Reset authenticator does not clear the wrong-code counter.
11. **Backups unproven:** no restore drill; PITR on Railway not confirmed.
12. **The Drive daily-upload count lives only in Redis;** no emergency purge or space tool.
13. **Errors go to the console only** until Sentry is approved (ADR-0029).
14. **Grievance Officer not named** (T&C section 12; [OWNER] placeholders here).
