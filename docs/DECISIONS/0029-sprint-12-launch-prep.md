# ADR-0029 — Sprint 12: launch prep before the launch accounts exist

**Status:** Accepted 4 Nov 2026. Taken on Darshil's behalf and overridable: say which decision
to change. Darshil's instruction: start S12 although its gate is not met, decide on his behalf,
ask only what only he can answer.
**Numbering:** the brief named this file 0028; ADR-0028 is already the Daylight section-heads
decision (2 Nov), so this is 0029.
**Sources:** PLAN §2 S12 ("EAS production builds, store listings, Sentry + PostHog, upload load
test, runbook, 10 staff dry-run bookings"), the S12 gate, PLAN §4 (definition of done), ADR-0008
(hosting), ADR-0023 (positioning), ADR-0027 (S11 as built).
**Split:** another agent owns the deployment files (Dockerfiles, Railway and Vercel config, EAS
profiles, `docs/DEPLOY.md`). This ADR owns everything else in S12.

## Context
- **The gate is not met.** T&C v2 is not published (brackets remain), the Grievance Officer is
  not named (OD-06, OD-09), and the D-U-N-S number and Apple organisation account do not exist
  (B7). The S12 *demo* ("store submission sent") cannot happen until they do. Everything that
  does not need them is done now.
- **Found while planning (each verified in code, 4 Nov):**
  - Staging and production **cannot run uploads yet**. The Google Drive adapter only throws
    (`infra/storage/adapters/google-drive.adapter.ts`), and `STORAGE_ADAPTER=local` is refused
    when deployed. (OTP SMS had the same problem; the MSG91 OTP adapter landed the same day,
    `256f228`, and now waits only on the DLT approval.)
  - The dev endpoints (OTP peek, payment simulator) exist only with `NODE_ENV=development`,
    `DEV_TOOLS=on` **and a localhost database** (`config/dev-tools.ts`, audit L5). They can never
    be on in staging. The brief's "seed staging via the dev endpoints" is therefore impossible by
    design (D5 answers it).
  - **A paid booking cannot be cancelled.** `POST /bookings/:id/cancel` accepts only QUOTED and
    ADVANCE_PENDING ("later states need the refund ladder", `checkout.service.ts`), and no staff
    route cancels a booking. The T&C §3.1/§3.2 cancellation ladder is unreachable. The same holds
    for DATA_LOSS: no route reaches it (ADR-0027 D5a).
  - The client app has no account deletion, no Razorpay checkout and no app icon, and `clickco.in`
    does not resolve (docs/store/README.md §4 lists all of them).

## D1 — What ships behind ports or config until the accounts exist
The ADR-0027 D1 rule stands: every outside provider is a port; the development adapter is refused
when deployed. Two exceptions, because they lose observability, not correctness: the console
`ErrorReporter` and the no-op analytics adapter are allowed in production until their SDKs are
approved (D2, D3).

| Capability | Port and adapter today | Live adapter | Waits on (owner) |
|---|---|---|---|
| OTP SMS | `SmsPort` → console | MSG91 OTP adapter (`SMS_ADAPTER=dlt`), **built in S12** (`256f228`) on `fetch` with recorded fixtures, no new dependency; same MSG91 account as lifecycle SMS | B6: DLT entity, header, OTP template |
| Lifecycle WhatsApp, SMS, push, calls | ADR-0027 D1 ports → console | Meta, MSG91, Expo, Exotel (built) | B4/B5 templates, DLT, Exotel KYC, `expo-notifications` approval |
| Payments | `PaymentGatewayPort` → sandbox | Razorpay (built). Test keys on staging, live keys in production | B3 Razorpay KYC; **client checkout UI needs `react-native-razorpay` (approval, D3)** |
| Media storage | `StoragePort` → local disk | **Google Drive adapter, built in S12** on Drive REST v3, the service-account JWT signed with `jose` (already a dependency): no `googleapis` | B10: Workspace, Shared Drive, service account |
| JPEG export | passthrough | darktable in the isolated media worker (deploy agent's image) | — |
| Error reporting | `ErrorReporter` → console (D2) | Sentry | `@sentry/node`, `@sentry/react-native` approval |
| Product analytics | `AnalyticsAdapter` → no-op (D3) | PostHog | `posthog-react-native` approval |
| Store builds | EAS profiles (deploy agent) | EAS production builds | B7 Apple org account (iOS); Play org account (Android) |
| Legal pages | `build:production` refuses while `apps/web/src/legal/config.ts` has gaps | — | OD-06 address, OD-09 Grievance Officer, privacy email |

**Staging stays production-shaped.** It is fully usable once the Drive adapter and the DLT and
Workspace accounts exist. We do not relax a staging guard to get there sooner. Until then, the
dry runs and the load tests run on the dev-mode stack (D5).

## D2 — Errors: an `ErrorReporter` port, scrubbed, console now, Sentry later
Built and tested in this sprint (`apps/api/src/infra/observability/`):
- **Port:** `ErrorReporter.report({ source, error, context })`. It must never throw. Both the API
  and the media worker get it from `ObservabilityModule` (global).
- **Reported:**
  - unhandled HTTP errors, and any 5xx except a deliberate 503 (`AllExceptionsFilter`);
  - a BullMQ job's **last** failed attempt (retries exhausted, or an `UnrecoverableError`),
    i.e. its dead letter;
  - worker errors (`infra/queues/job-failure.ts`), at most once a minute per queue and message,
    because a Redis outage makes every worker reconnect over and over (each one is still logged);
  - process crashes, observed through `uncaughtExceptionMonitor`. Node still exits and the
    platform restarts the service, exactly as before. A promise rejected with a non-Error is
    reported with a fixed message: Node's own message inspects the whole rejected object.
  - Earlier failed attempts are a scrubbed warning only.
- **Not reported:** 4xx answers and 503s: the API working as designed.
- **Context allowed** (flat values only, by type):
  - HTTP: the method, the route **pattern** (`/d/:token`, never the URL, which can carry a
    delivery token), the status and the caller's kind;
  - jobs: the queue, job name, job id and attempt counts.
  - Never a request body, headers, query or **job data** (an OTP job carries a phone number).
- **PII scrubber** (`pii-scrubber.ts`, 33 tests). Everything an adapter sends passes through it.
  - **Keys** are replaced whole: phone, mobile, email, contact, token, password, secret,
    authorization, cookie, API and private keys, bank, account number, IFSC, Aadhaar, PAN, any
    key ending in UPI/VPA/OTP, address, landmark, pincode, people's names (full, display,
    holder, beneficiary, customer, booker…), signature, credentials, lat/lng/location, date of
    birth, GSTIN.
  - **Text** is masked, in this order: JWTs; `Bearer`/`Basic` credentials; `/d/<token>` paths;
    then long opaque runs (32+ characters mixing letters and digits, base64 included) **whole**,
    so no later rule can split a secret into short pieces that survive; then emails, UPI ids,
    phone numbers (E.164, and Indian with `+91`/`91`/`0` prefixes, spaces, dots or hyphens),
    Aadhaar-shaped and 9+-digit runs (accounts), PAN and IFSC.
  - UUIDs are set aside before any rule runs and put back after, so they survive even inside
    job ids (`jpeg-export-<uuid>`): they are how a report is traced to a booking.
  - Text is scrubbed whole (up to 20,000 characters) and only then cut to 2,000, so a cut never
    leaves half a phone number. The result is a bounded, cycle-safe copy (depth 8, 50 items).
    The input is never changed.
  - A security review (4 Nov) found no CRITICAL or HIGH issue; its MEDIUM and LOW findings on
    the scrubber, crashes and worker errors are fixed above, each with a test.
- **Console adapter:** one line per report, `{"type":"error_report",…}`, on the Nest logger
  (context `ErrorReporter`). The runbook searches for `error_report`. The filter's old raw
  `Unhandled error` stack log is gone: it could carry personal data.
- **Sentry, once approved:**
  - API and worker: `@sentry/node`, behind `ERROR_REPORTER=sentry` + `SENTRY_DSN`. Both become
    required when deployed, and the console adapter is then refused there.
  - `sendDefaultPii: false`; a `beforeSend` that replaces the event's message, exception and
    extra with `toErrorEvent` (the same scrubbed shape) and drops request data, cookies, headers
    and breadcrumbs' URLs.
  - Errors only at launch: `tracesSampleRate: 0`, no profiling, no replay. Releases are the git
    SHA. EU data region.
  - No `setUser`: a report is never linked to a person, so the store privacy labels declare
    crash data as "not linked to you" (docs/store/privacy-labels.md C11).
  - Crashes: Node exits right after the monitor event, so the adapter reports them through
    Sentry's own `onUncaughtException` integration (which flushes), not a fire-and-forget send.
  - The apps: `@sentry/react-native` with the same settings, source maps uploaded by EAS
    (`SENTRY_AUTH_TOKEN` as an EAS secret). The scrubber moves to `packages/utils` then, so the
    apps use the same rules.
- **Paging:** nothing pages anyone today (runbook gap). Until Sentry alert rules exist, the owner
  watches the `ops.alert` feed on the admin "Today" page. A CRITICAL `ops.alert` pushing to the
  owner's phone is an S12 follow-up.
- **Uptime:** an external monitor on `GET /health` every minute, alerting by email and SMS
  (Better Stack or UptimeRobot free tier). `/health` checks Postgres only. A queue-heartbeat
  check (the outbox tick's last run) is an S12 follow-up.

## D3 — Product analytics: a typed, PII-free catalogue and a no-op port
- **Catalogue:** `packages/contracts/src/analytics.ts`, the only events and properties the apps
  may send:
  - the client booking funnel: app opened, sign-in, serviceability, shoot picked, quote viewed,
    details completed, booking created, payment started, succeeded and failed, cancelled,
    delivery opened, review, ticket, quality issue;
  - the Pro job loop: offer viewed, accepted and declined; checked in and out.
  - Every property object is strict, and every string is an enum or a short upper-case code.
    Money travels as a coarse `priceBand`. No ids, references, names, phones, pincodes,
    coordinates or free text: a stray key drops the event (tested).
  - Screens are named by route pattern (`/bookings/[id]`), from a fixed list per app.
- **Port:** `packages/utils/src/analytics.ts`, `createAnalytics({ adapter, validate, screens,
  enabled })`. It drops what the catalogue rejects and never throws into a screen. Each app has
  one instance in `src/shared/analytics.ts`, on `noopAnalyticsAdapter`. The screens are not
  wired yet (another agent owns them); wiring is one `track` call per funnel step.
- **PostHog, once approved:**
  - `posthog-react-native` with `customStorage` on MMKV (never AsyncStorage, CLAUDE.md);
  - no `identify()` (events stay anonymous per install), `reset()` on sign-out;
  - no autocapture, no session replay, project setting "discard client IP", EU cloud;
  - an "Analytics" opt-out switch in Profile feeds `enabled`;
  - the privacy policy names PostHog and Sentry as processors (owner item).
  - The website keeps no analytics: its CSP allows no third-party script (ADR-0027 D6c).

### Dependencies for approval (none installed)
| Package | Version (npm, 4 Nov 2026) | Where | Why |
|---|---|---|---|
| `@sentry/node` | 11.10.0 | apps/api (API and media worker) | D2 error reporting. Node engines `>=22.12` match `.nvmrc`. Brings OpenTelemetry packages transitively |
| `@sentry/react-native` | 8.33.0 | apps/client, apps/pro | D2 crash and error reporting, with its Expo config plugin. Confirm the SDK-56 pairing with `npx expo install @sentry/react-native` and pin what it picks |
| `posthog-react-native` | 4.85.3 | apps/client, apps/pro | D3. Its storage and session-replay peers are optional: use `customStorage` (MMKV), and do not install `@react-native-async-storage/async-storage` or the replay plugin |
| `react-native-razorpay` | latest at approval | apps/client | Checkout (store README B4). Not part of the observability ask, listed so the owner sees every pending dependency together, with `expo-notifications` (ADR-0027) |

Not proposed: `@sentry/nextjs` (admin and portal errors reach the API's reporter; revisit after
launch), `posthog-js` (the website stays script-free), `googleapis` (D1: REST plus `jose`).

## D4 — Load tests: what, where and the targets
- **Scripts:** `loadtest/` (k6 is a standalone binary, never an npm dependency).
  - (a) `upload.js`: the portal's chunked upload, mirrored from `apps/portal/src/features/upload`;
  - (b) `booking.js`: quote → booking → pay through the sandbox webhook → confirmed; every fifth
    funnel cancels before paying instead;
  - (c) `delivery.js`: the public `/d/<token>` listing and file downloads.
  - Seeding is `loadtest/seed/seed.mjs`: plain Node, no packages.
- **Where — the load-test stack.** One VM sized like production (start at 4 vCPU / 8 GB). It
  runs the same API and worker images with Postgres and Redis on `localhost`, with
  `NODE_ENV=development` and `DEV_TOOLS=on`: the only shape `env.ts` lets the dev endpoints run
  in.
  - Synthetic data only, never production data. Destroyed after each run.
  - `TRUST_PROXY_HOPS` is one above its real proxies, so each k6 VU's `X-Forwarded-For` gives it
    its own client IP. Otherwise one machine is one IP, and the per-IP limits are all you measure.
    **Never** on staging or production.
- **Launch assumptions:** Surat, Mumbai, Vadodara; 55 photographers (PLAN §2); tens of bookings
  a day at first. Most shoots end in the evening, so uploads bunch together. A creator post can
  spike traffic.
- **Targets (k6 thresholds; a run fails if any is missed):**

| Path | Load | Targets |
|---|---|---|
| (a) Upload | 20 photographers at once, 4 parts of 8 MiB in flight each (`MEDIA_LIMITS`) | part server time (`http_req_waiting`) p95 < 1.5 s, p99 < 4 s · session create p95 < 1.5 s · file complete p95 < 1 s · errors < 1 % |
| (b) Quote → book → pay | ramp to 2 new funnels a second, hold 6 min (about 12 API requests a second); a stress run at 5 finds the knee | quote p95 < 300 ms, p99 < 800 ms · create p95 < 600 ms · pay and webhook p95 < 800 ms · paid → CONFIRMED p95 < 5 s (2 s outbox tick) · errors < 0.5 % |
| (c) Delivery link | 30 listings a second + 10 people downloading | listing p95 < 300 ms, p99 < 1 s · file first byte p95 < 800 ms · errors < 0.5 % |
| All | — | no 5xx `error_report` lines during the run; checks > 99 % |

- **Limits we accept:**
  - Uploads go to local disk until the Drive adapter exists. Drive's throughput and its
    750 GB/day ceiling are tested again then.
  - At most about 22 upload VUs with the dev seed (one checked-out shoot per photographer).
  - A run lasts at most 14 minutes: seeded access tokens live 15.
  - Seeding a shoot to CHECKED_OUT takes about 4 hours of real time: a 2 h minimum lead plus a
    2 h minimum shoot (`MIN_FILL_WINDOW` + auto-refund lead; `Hours` min 2).

## D5 — Dry runs
- **Scripted smoke:** `scripts/dry-run/run.ts` (tsx from apps/api) drives one booking through
  every state:
  - quote → pay → dispatch → accept → en route → check-in → start → check-out → upload → JPEG
    export → staff QA → balance → delivery link (bytes verified) → review;
  - it uses the real client, Pro and admin SDKs (`packages/api-client`), with the dev endpoints
    only for the OTP, the payment webhook and the dispatch view;
  - it prints a PASS/FAIL line per step;
  - check-out cannot come before the booked hours are over, so the run pauses there and resumes
    (`--resume`), or waits in-process (`--max-wait-minutes`).
  - Run it before every staff session. It refuses `api.clickco.in`, and needs the dev tools.
- **The 10 staff dry runs:** real people on the real apps (EAS preview builds) and the admin panel.
  - Each booking follows one variant (`scripts/dry-run/CHECKLIST.md`): standard, cancellation,
    extension, access denied, data loss, refund, credit, quality issue, ticket, block,
    moderation.
  - **Pass** for each run:
    - every state is reached as the checklist says;
    - every message the console adapters record is right;
    - money is right to the paise: invoice, ledger, refund, credit, payout and TDS;
    - the admin desk shows the item, with an audit row;
    - no `error_report` lines.
  - **S12 passes** when all 10 pass and the standard flow passes twice in a row with nothing
    fixed in between.
- **Where:**
  - until staging can take uploads (D1): the dev-mode stack, with the payment simulator for money and
    the OTP peek for sign-in;
  - before public launch, once more on staging: Razorpay test mode, real SMS to staff phones,
    Drive. That run is the launch gate.
- **Who:** the owner as ops and finance, two vetted photographers, and two people as clients.
  Finance's maker–checker needs a second FINANCE or SUPER_ADMIN account (owner item).

## D6 — Store listings: positioning and choices
Drafts are in `docs/store/`, with nothing submitted.
- **Positioning (ADR-0023):** Gen Z, creators and everyday moments, as the website already says:
  a new-city shoot, a proposal, a creator content day, a birthday, a café launch, convocation.
  Photos and video. Video is camera-original and priced in the app, never "edited reels".
  Videographers are never called "verified".
- **Client app "Clickco":** App Store primary Lifestyle, secondary Photo & Video; Play: Lifestyle.
  - Apple's age rating comes out at 4+ from the questionnaire.
  - Play's target audience is 18+: booking and paying is a contract, and minors cannot contract.
    The T&C needs a matching 18+ clause (owner).
- **Pro app "Clickco Pro":** Business, secondary Productivity. iOS as an *Unlisted* app (request
  it from Apple); Play as a public listing that says plainly only invited photographers can sign
  in, with the restricted-access declaration.
- **Privacy labels:** derived from the code (`docs/store/privacy-labels.md`, each answer cites
  its source). Crash data and product analytics are declared from the first build that carries
  Sentry or PostHog.
- **Before submission:** in-app account deletion (client app, plus a web page for Play); a review
  sign-in that needs no SMS; app icons; privacy links inside both apps; and either ship or remove
  every `[GATE]` line. Each is engineering work, tracked in `docs/store/README.md` §4.

## D7 — Runbook
`docs/RUNBOOK.md` is the on-call guide, written from the code: health and logs, each `ops.alert`
reason and what to do, the outbox, BullMQ, payment webhooks, payouts (maker–checker recovery),
storage, rotating each secret, restore, safe shutdown, staff lockouts, and incident comms. Deploy
and rollback live in `docs/DEPLOY.md` (deploy agent). Its §13 lists the operational gaps the code
has today. They become S12 follow-ups, not runbook workarounds.

## S12 follow-ups (engineering, in priority order)
1. The Google Drive adapter (D1). Without it, staging and production cannot store an upload.
   (The MSG91 OTP adapter, the other half of this item, landed in `256f228`.)
2. Cancelling a paid booking: the client (the T&C §3.1/§3.2 ladder, peak-season forfeit) and
   staff on the booking page, through the existing refunds module. Plus the staff route that
   confirms DATA_LOSS (HANDOVER §4). Both are needed for dry runs 2 and 4 (CHECKLIST.md).
3. Account deletion: an ADR plus a schema addendum (the next free number is 0019; the phone
   CHECK and the 72-month invoice retention shape it).
4. A store-review sign-in, with its bookings fenced off from dispatch and money.
5. Razorpay checkout in the client app, once approved.
6. Paging for CRITICAL ops alerts; a queue heartbeat in `/health` or a sibling route.
7. Runbook §13 gaps:
   - re-driving outbox events and jobs without SQL;
   - an overlap window for the Razorpay webhook secret;
   - a re-seal for `STAFF_TOTP_KEY`, and a re-seal job for `BANK_ACCOUNT_KEY`;
   - a bulk delivery-link revoke.
8. Wire `analytics.track` into the funnel screens (the app-screens agent).
9. Fix the store README's B9: the full UPI id is stored per payment (`payments.vpa_or_last4`).
   Mask it as the refunds path already does.

## Owner-only
1. **Approve the dependencies** in D3, plus `expo-notifications` (ADR-0027) and
   `react-native-razorpay`.
2. **Legal:** the registered address (OD-06), the Grievance Officer's name, email, phone and
   address (OD-09), the privacy email, an 18+ eligibility clause, and publishing T&C v2 after
   legal review.
3. **Accounts:**
   - D-U-N-S, then the Apple Developer organisation account, the Play Console organisation
     account, and an Apple request for Unlisted distribution of Clickco Pro;
   - Sentry and PostHog accounts (EU region);
   - an uptime monitor.
4. **Providers:** DLT entity, header and OTP template; MSG91; Razorpay live KYC; Google
   Workspace, Shared Drive and service account (B10); the `clickco.in` DNS on Cloudflare (the
   domain does not resolve today).
5. **People:** who takes part in the 10 dry runs, and a second FINANCE or SUPER_ADMIN account for
   maker–checker payouts.
6. **Product:** is video in the launch build? The client app says "photos only at launch", which
   contradicts ADR-0023 and the website. Supply real, model-released photos for the store
   screenshots.
7. **Budget:** the load-test VM for one day, and the Sentry and PostHog plans (both have free
   tiers that cover launch volume).
