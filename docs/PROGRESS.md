# PROGRESS

Updated at the end of every session. Newest first.

## 2026-10-28 · Sprint 9 — staff admin panel foundation + ops desks (ADR-0025, branch main)
**Shipped**
- **API (`modules/admin`):**
  - Staff sign-in with email, password (scrypt) and a mandatory TOTP code. The TOTP secret is
    encrypted with AES-GCM under `STAFF_TOTP_KEY`; first sign-in enrols it.
  - Lockouts and rate limits on sign-in.
  - Staff sessions: 12 h fixed, plus a 60-minute idle limit enforced by the server.
  - `StaffGuard`, `@Roles` and city scoping: the ADR D3 matrix, checked cell by cell.
  - An append-only audit log written in the same transaction as each change. A test fails if any
    `/admin` mutation lacks `@Audited`.
  - Desks:
    - booking board (filters, IST dates, search, keyset paging) and booking page with audit trail;
    - QA pass/fail with the real staff actor;
    - incident confirm;
    - dispatch list and detail;
    - breach board: attribute to CLIENT or FORCE_MAJEURE only, and waive; no money moves;
    - alerts feed;
    - staff management;
    - cities.
  - `staff:create` (first SUPER_ADMIN) and `staff:totp` (dev) scripts; dev seed has one account
    per role.
- **`packages/ui-web`:** shadcn on Tailwind 4 + Radix, themed from `colorLight` tokens. A test
  checks every variable against a token, text contrast and that amber is never used for text.
- **`createAdminApiClient`:** every route typed, request bodies validated, every response pinned.
- **`apps/admin` is now the staff panel:**
  - Sign-in and enrolment.
  - Navigation by role.
  - Every desk.
  - Nonce CSP, COOP/CORP, sessionStorage tokens, 30-minute idle sign-out.
  - Open-redirect-safe `?next=`.
  - The old simulators moved to `/dev`, which is a 404 outside development.
- **Mobile M1 closed:** both Expo apps keep MMKV encrypted. The key is in the Keychain/Keystore
  via `expo-secure-store` 56.0.4, using `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Existing installs are
  migrated once.
- **Seen working in the browser against the live API:**
  - super admin sign-in with TOTP;
  - board with live bookings, booking page, dispatch desk;
  - create a staff member (temporary password shown once);
  - that person's first sign-in and authenticator enrolment;
  - the ops-agent role sees only its desks, and the API returns 403 for the others.
- **Tests:**
  - API 999 (with `--maxWorkers=2`), including 29 admin e2e;
  - admin 96 · ui-web 67 · api-client 55 · contracts 58;
  - client 102 · Pro 219;
  - typecheck 17/17.
- **Reviews:**
  - Domain: no violations. Breaches put down to the client now owe nothing (they leave the OPEN
    queue).
  - Security: no critical or high on either side; the medium findings are fixed (ADR-0025
    §Built).

**Decisions:** ADR-0025 (and its review section). Breach re-attribution is limited to CLIENT or
FORCE_MAJEURE, per ADR-0016 D9.

**Open (ADR-0025 §Open):**
- Password expiry and reset are not built yet.
- Idempotency keys must be scoped to (action, entity) before the money desks.
- Duplicated browser tabs.
- The https deploy check is opt-in.
- The ops alert feed reads `domain_events` directly.

**Local sign-in:**
- Run `pnpm --filter @clickco/api db:seed:dev`. Accounts are `super-admin@clickco.test` etc.,
  password `clickco-dev-staff-only`.
- For the code, run `pnpm --filter @clickco/api staff:totp <email>`.
- The panel is at http://localhost:3001. The API needs `CORS_ORIGINS` to include it.

**Waiting on Darshil / CA:**
- TDS section and rates for photographer payouts (S10).
- The breach remedy amounts (SA-21).
- GST credit notes on refunds of invoiced money (S10).

**Next:** S10:
- refunds and credits, plus settling review items;
- breach remedies;
- payouts + TDS;
- pricing editor (FINANCE + 2FA);
- onboarding kanban and KYC queue;
- QM queue;
- grievance tickets (SA-02);
- equipment claims (SA-01);
- penalty waivers;
- password reset.

## 2026-10-28 · Sprint 6 frontend — the Clickco Pro app (ADR-0024, branch main)
**Shipped**
- `apps/pro`: second Expo SDK 56 app on the client's pinned toolchain plus `expo-location` 56.0.26
  (approved by Darshil 28 Oct). White theme, `@clickco/ui` primitives.
- Screens:
  - **Sign-in:** PRO_LOGIN.
  - **Jobs tab:** your jobs, new offers with live countdowns and polling every 10 s, uploads due.
  - **Offer detail:** accept or decline.
  - **Job screen:** on my way → geofenced check-in → start → timer, 1-hour extensions, waiting time,
    access-denied / unsafe / client-absent reports → check-out with frame count → upload deadline.
    Cancel until check-in.
  - **Earnings and Profile:** Profile includes the sync queue.
- **Offline write-ahead queue (G-19):** on-site taps without signal are saved with their time and
  sent in order on reconnect. Pure core with tests; MMKV-persisted.
- `@clickco/api-client`: `createProApiClient` plus a configurable refresh path (`/pro/auth/refresh`).
- **API:** `GeoFixBody.mocked`; mocked fixes are refused (422 `LOCATION_MOCKED`) at check-in,
  check-out and client-absent (ADR-0015 M3).
- **Seen working in the browser against the live API:** accept → on my way → check-in with a GPS
  fix → offline Start queued, then synced on reconnect → extension request pending with the
  client.
- **Tests:** Pro 197 · api-client 30 · contracts 58 · API 887 (+1 mocked-fix e2e) · typecheck 16/16.
- **Security review:** no critical or high. Medium and low fixes were applied before commit (see
  ADR-0024 §Security review).

**Open / launch blockers**
- **Encrypted token storage (M1).** Refresh token to Keychain/Keystore via `expo-secure-store`
  (new dependency, needs approval) or encrypted MMKV; exclude MMKV from backups. Applies to
  `apps/client` too.
- **S9 API follow-ups:** start/en-route `deviceTs`; optional `lat`/`lng` on safety reports;
  logging of mock attempts.
- **Not tried on a phone yet:** needs a dev build (`pnpm --filter @clickco/pro android`).
- **Doc 01 elements left out** (no API data yet): availability toggle, city ranking, 30-day chart,
  masked calls, map thumbnail.

**Note:** on this machine the full API suite times out at the default parallelism; it passes with
`npx vitest run --maxWorkers=2` (~2 min).

**Next:** S9–10 admin panel (staff QA desk, dispatch/SLA boards, refunds, payouts) · M1 storage
hardening.

## 2026-10-26 · Video + Gen Z / creator positioning (ADR-0023, branch main)
**Shipped**
- OD-11 resolved by the owner: video is in scope. The site sells photographers and videographers;
  video is "priced in the app" (no rate in doc 05 yet) and delivered unedited, camera-original
  (Terms §4.3), with reel edits as a paid add-on.
- Hero: "Pro photos and reels. No DMs, no haggling." Picker gains Capture (Photos / Video /
  Photos + video); video never shows a rupee figure (`describeQuote`, tested). The visual becomes
  a vertical sample reel when video is chosen.
- "Made for moments like this": new city, proposal, creator day, birthday, café launch,
  convocation, each mapped to a rate-card shoot with an exact "photos from" price; "Book this"
  (`#shoot-<id>`) pre-fills the picker.
- Reels wall (7 vertical loops) + "For creators" block (Terms §9.2 usage rights).
- Mobile "your shoot" bar after the picker scrolls away (hidden from the waitlist on).
- 8 Pexels-licence sample reels in `public/reels` (720×1280, ~1 MB, no audio, posters), credited in
  `content/reels.ts`; play only on screen, never under reduced motion.
- Copy that said "photography only" updated (FAQs, plan exclusions, footer, site meta).
- Fixed a stray `}` in base.ts (from the ADR-0021 font change) that dropped the `p{margin}` rule.

**Not done:** video rates in the pricing engine (doc 05 v2), `plan_deliverables.video_included`,
videographer vetting rubric, video storage planning. Proposal, birthday, convocation, café and
creator sample reels are not Indian footage; replace first with Clickco's own.

## 2026-10-25 · Home hero: shoot picker + sample photography (ADR-0019, branch main)
**Shipped**
- apps/web home hero rebuilt after Urban Company's service picker: headline across the page, then
  a picker (7 category tiles, city, hours 2–8, tier) with the live total with GST from the rate
  card (`quoteFor`, tested), a waitlist CTA, a link to the city × category page, and a photo of the
  chosen category. Works without JS (radios + opening quote are server-rendered).
- Removed the template patterns: live-dot chip, photo pill in the headline, collage, floating
  status cards, camera captions, corner marks, glows, and the category marquee under the hero.
- 15 licensed sample photos (Unsplash/Pexels licence, 1600 px, metadata stripped) in
  `public/photos`, credited in `src/content/photos.ts`; used by the hero, steps, categories,
  cities, the app panel and the city/category page heroes. Footer says they are samples.
- New site primitives: `.seg` (segmented radios) and `.stepper`. Web tests 133.

**Not done:** Clickco's own photography (replace `public/photos/*` file for file); identifiable
people in stock photos have no model releases, so keep them out of paid ads and print.

## 2026-10-24 · Daylight — desktop header gap fix (branch feat/web-daylight)
**Shipped**
- apps/web: on desktop the floating header sat in its own flat 80px strip, so each hero's
  daylight glow started below it with a visible seam. The header now overlays the first band
  (`headerOverlay` in styles/tokens.ts) and `.hero`, `.page-hero` and legal pages add the same
  amount back to their top padding — the glow runs to the top edge, content does not move.
  Mobile unchanged. Web tests 129 green, typecheck and lint clean, static export builds.
- Repo pushed to github.com/darshil320/Clicko (`main`, public). The local branch
  feat/web-daylight was renamed to `main`.
- Vercel: project `clickco-web` in darshil320s-projects, Git-connected (pushes to `main` deploy to
  production), root `apps/web`, Node 22.x, `ENABLE_EXPERIMENTAL_COREPACK=1` for pnpm 11.
  `apps/web/vercel.json` installs only the root + web workspace and builds with plain pnpm.
  Live at https://clickco-web.vercel.app.

**Not done:** the deploy runs `build`, not `build:production` — legal pages show the Draft notice
and the waitlist form posts to localhost until the legal fields and `NEXT_PUBLIC_API_URL` exist.
clickco.in is not attached. Local git authenticates as darshil321, which cannot push to
darshil320/Clicko.

## 2026-10-24 · Daylight — marketing website redesign (branch feat/web-daylight)
**Shipped**
- ADR-0018 + docs/DESIGN-DAYLIGHT.md: a marketing-only brand layer on the white theme. Warm paper
  ground, linen bands, sage/clay/haze tints, one darkroom band, placeholder photo colours,
  Instrument Serif display + Inter Tight + Geist Mono (self-hosted via next/font, no new deps)
- design-tokens: `colorDaylight` (colorLight's names), `daylightExtras`, `daylightType`,
  `daylightRadius`, `daylightElevation`; tests mirror the doc and check WCAG AA per ground
- apps/web: PhotoFrame with seven placeholder moods (real photos drop in via `src`); editorial
  hero with photo collage around the real Surat quote; photo cards for steps, categories, cities;
  tinted trust tiles; pricing on the linen band; Emergency table on the darkroom panel; amber app
  panel; capsule header; darkroom footer with wordmark; photo heroes on city/category/cities pages
- Content, prices (rate card, paise), lead-time table, waitlist form, legal links: unchanged
- Tests: web 129 · design-tokens 76 · repo typecheck and tests 15/15

**Visual reference:** the Clickco Daylight design-system artifact (claude.ai, private to Darshil).

**Not done:** real photography (frames show placeholder moods); Darkroom (dark) website theme is
out of scope; `build:production` still needs `NEXT_PUBLIC_API_URL` and the legal fields, as before.

**Note:** `main` does not exist; `master` is 49 commits behind, so this branch is cut from
feat/sprint-5-dispatch. Local pnpm 11 needs Node 22 (`nvm alias default 22` set; restart the app
so hooks pick it up).

## 2026-10-24 · Sprint 8 (delivery + SLA) and the white theme
**Shipped**
- S8 API: QA gate (dev console until the S9 desk); balance order with the GST invoice issued at
  capture as the exact remainder of every snapshot; links released only once everything is paid,
  behind Clickco's opaque `/d/<token>`; the SLA machine (production clocks from T0, RUSH_24H
  halved, pause in BALANCE_PENDING, three balance reminders, abandon at 30 d, breach rows with a
  provisional remedy never applied automatically, a sweep for lost jobs); RAW purged +7 d, JPEG and
  links +30 d, then CLOSED; unsafe-site bookings upload what was shot
- 13-scenario delivery e2e test; API 886 tests green
- White theme tokens (`colorLight`, elevation, section rhythm, motion) with WCAG contrast tests;
  the website, the upload portal and the client app are being restyled to it

**Decisions:** ADR-0016 (S8 design), ADR-0017 (white theme). SA-15–SA-22.

**Housekeeping:** the disk filled twice (Docker's VM disk too). The e2e harness now cleans its
storage per app; Docker was restarted; leaked test databases dropped.

**Waiting on Darshil:** the breach remedy amounts (SA-21), CA confirmation of the balance invoice
timing (SA-15), clickco-01 §4 v2 for the white theme (SA-22).

**Next:** finish the white-theme pass and review every screen · the Pro app (S6 frontend) · S9–10
admin panel (staff QA desk, finance desk for refunds, credits and breach remedies)

## 2026-10-24 · Sprints 6 (API) and 7, security review closed
**Shipped**
- S6 on-site API: en-route, geofenced check-in/out (150 m; fallback points accepted unverified),
  offline queue with a device-time floor, extensions (client approve/decline, 1-h blocks, max 4),
  waiting time, client non-attendance, access-denied/unsafe-site reports, no-show ladder
  (alert +15, escalate +20, penalty + re-broadcast), earnings
- S7 media: StoragePort (local disk; Drive stub), resumable chunked uploads with per-part and
  whole-file SHA-256, reconcile → PROCESSING, JPEG export (darktable or dev passthrough) → QA,
  integrity audit, quota monitor; upload portal (apps/portal, :3002)
- Security review of S6–S7: 3 high, 9 medium, 8 low. All fixed or decided (ADR-0015), including
  file-signature checks, an isolated darktable environment, storage reservation plus an idle-session
  reaper, a nonce CSP on the portal, server-side photographer sign-out, and deploy env guards
- Tests: API 858 · portal 29 · contracts 58 · client 80 · ui 38 · api-client 24 · web 119

**Decisions:** ADR-0013 (on-site), ADR-0014 (media), ADR-0015 (security review).

**Housekeeping:** the Mac's disk was full (124 MiB free; `ENOSPC` broke a build). I dropped 15
leaked scratch test databases. 2 GiB is free now; Darshil should free more (npm cache 5.4 GB,
Docker build cache 1.5 GB).

**Next:** S8 delivery + SLA machine · the Pro app frontend (S6, Expo) · S9–10 admin panel

## 2026-10-23 · Sprints 3, 4 (v0), 5 and marketing site
**Shipped**
- S3 bookings + payments: state machine with outbox, server re-pricing + snapshot, sandbox/Razorpay gateways,
  signed replay-safe webhooks, GST advance invoices, balanced ledger, idempotency keys
- S4 v0 client app (Expo, web + phone bundles) for Screens 1–6 on live data; `@clickco/ui`, `@clickco/api-client`
- S5 dispatch: outbox publisher, PostGIS eligibility + ranking, 4-wave cascade, emergency broadcast, first-accept-wins,
  unfilled auto-cancel at T-90 for every band, photographer OTP + offers/accept/decline/cancel, re-dispatch + penalties,
  ops alerts, async OTP SMS (sealed job payloads)
- Marketing site (apps/web): home, cities, 3 hubs, 21 city×category pages, sitemap, JSON-LD, waitlist
- Console: booking simulator + dispatch desk; full journey verified live in the browser (book → pay → dispatch → accept)
- Tests: API 650 · client 80 · ui 38 · api-client 24 · web 119 · contracts 41 · others green

**Decisions:** ADR-0011 (state machine), ADR-0012 (dispatch review: unfilled auto-cancel all bands, lead-time floor,
capture outcomes, no-show incentive on base share, penalties, async OTP, outbox backoff). SA-14 (3–8h not guaranteed).

**Next:** S6 Pro app + check-in/out/extensions/no-show detector · S7 upload portal + StoragePort · S8 delivery + SLA

## 2026-10-23 · Sprint 4 v0 — client app (pre-approved by Darshil; Figma gate waived for v0)
**Shipped**
- `packages/api-client`: typed fetch SDK over `@clickco/contracts` — envelope unwrap + contract validation,
  typed `ApiError`, bearer token, single-flight refresh-on-401, Idempotency-Key helpers (22 tests)
- `packages/ui`: the ten doc 01 §6 primitives + S4 foundations (Text, Icon, Skeleton, Checkbox, Switch, Screen),
  NativeWind classes from the token preset only (38 tests). Shipped as TS source.
- `apps/client`: Expo SDK 56 + expo-router, NativeWind 4, TanStack Query, Zustand + MMKV, RHF + zod.
  Screens 1–6 on the live API (sign-in, Home, Plan, Configurator, Review, sandbox Pay, Confirmed, Bookings,
  Booking detail); Screens 7–10 are status-driven placeholders in Booking detail (79 tests)
- Design tokens preset gained `min-h-tap` / `h-button` / `h-input` / `tracking-micro` (derived from `layout`)
- `formatINR` no longer uses `Intl` (Hermes-safe; identical output)
- Verified on web: sign-in (dev OTP) → pincode 395007 → configurator live quote → review → pay → simulate →
  confirmed → booking detail, against the real API. Native bundles compile; not run on a device (no Xcode here)

**Needs action**
- API `CORS_ORIGINS` must include `http://localhost:8081` (Expo web) — apps/api/.env
- Tier palette, photography imagery and the Figma pass (design-verifier) — B16 still open
- Security review (S4, no CRITICAL): fixed refresh-on-429 sign-outs, cross-tab token sync, draft/cache
  cleared on session end, dev endpoints refused outside `__DEV__`, UUID-checked paths, Android backup off.
  **Launch blockers:** refresh token at rest is plain MMKV/localStorage (→ Keychain via expo-secure-store or
  an MMKV encryption key; web → HttpOnly cookie); API refresh-token rotation ignores its grace window;
  release builds must require an https `EXPO_PUBLIC_API_URL`; T&C version is still `v2-draft`

## 2026-10-23 · Sprint 2 — pricing engine (done) · Sprint 3 started
**Shipped (S2)**
- Pure pricing engine (doc 05 §3, 12 steps) — bigint paise, one rounding, MAX surge, IST night/weekend,
  travel by metres, add-ons, promo, GST CGST/SGST vs IGST by place of supply, advance split, payout
- 231 engine tests covering the full doc 05 §10 matrix, written by a separate agent from the spec without
  seeing the implementation: zero disagreements with the independently written engine
- Launch ruleset `2026.10.01` (effective 1 Oct for dry runs) from one fixture shared by tests and DB seed;
  DB round trip proven exact; snapshot-immutability trigger proven
- `POST /pricing/quote`; contract-validated responses
- **Ops console** (`apps/admin`, `pnpm console` → http://localhost:3001): build status with live system
  checks, pincode checker, quote calculator, booking simulator (S3)
- Docker restarted; all DB integration + e2e suites now run and pass

**Decisions taken**
- Ruleset effective 1 Oct 2026 (version 2026.10.01) so pre-launch testing prices correctly
- Payout = tier share × (base + addons) + travel, exactly doc 05 step 12 (addon-level shares unused in v1)
- API `subtotalPaise` is pre-discount, discount reported separately (SA-12)
- Signature returns QUOTE_ONLY before duration validation
- Console built with token CSS now; moves to shadcn (`@clickco/ui-web`) with the real admin in S9

**Spec findings:** SA-12 (doc 05 §7 example omits surge), SA-13 (no model-release consent column → addendum 0003)

**Run it:** `pnpm db:up && pnpm db:migrate && pnpm db:seed`, then `pnpm api` and `pnpm console`

## 2026-10-22 · Sprint 1 · session 1 — auth + serviceability
**Shipped**
- Phone OTP login: `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `GET /me`
  - OTP: 6 digits, HMAC-hashed (bound to challenge + phone), 5-min TTL, 5 attempts, single use,
    newest-code-only, purpose-checked; limits 30s cooldown, 5/h + 10/day per phone, 20/h per IP (/64 for IPv6),
    enforced under advisory locks so parallel requests can't race
  - Sessions: 15-min HS256 access JWT (`typ at+jwt`, exp/iat/sub required), 30-day opaque refresh
    tokens stored hashed, rotated on use, 30s retry grace, reuse ⇒ revoke all; blocked users lose all sessions
- Pincode gate `GET /serviceability/:pincode` + `POST /waitlist` (IST date bounds, 3 joins/phone/day)
- Seed: Surat LIVE, Mumbai LIVE, Vadodara PILOT + pincode ranges (`db:seed`, idempotent)
- Standard `{success,data,error}` envelope + global exception filter; Zod validation pipe; per-IP throttle
- Security review done; all High/Medium findings fixed. DI made metadata-free (`@Inject` everywhere) and
  guarded by `app.module.test.ts`; compiled build smoke-booted

**Not yet verified**
- DB integration + e2e suites (`app.e2e.test.ts`, migration tests) — written, NOT run: Docker daemon hung this session.
  Run `TEST_DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco pnpm test` after restarting Docker.

**Deferred (tracked)**
- Absolute session lifetime + refresh-token family id → needs a schema addendum (S3, with payments auth work)
- Throttler storage → Redis before running more than one API instance
- Waitlist launch notifications must confirm consent/phone ownership before messaging (S11)
- `drizzle-kit pull` deferred: repositories use typed postgres.js SQL; revisit when joins get heavy (S3)
- DLT SMS adapter (blocked on PLAN B6); seeded pincodes need India Post verification + zones/centroids

## 2026-10-22 · Sprint 0 · session 2 — Sprint 0 closed
**Shipped**
- Review fixes (migration runner locking/ordering, 503 health, localhost-only Docker, test-DB guard)
- `apps/web` legal-pages site (static export): /terms, /refund-policy, /privacy, /grievance. T&C text rendered from the spec, never copied; entity = Clicko
- `pnpm --filter @clickco/web build:production` blocks publishing while any legal field is unresolved

**Waiting on Darshil**
- Registered address, privacy email, Grievance Officer → fill `apps/web/src/legal/config.ts`, then deploy to `clickco.in` and start Razorpay KYC
- Video at launch (default photos-only); `clickco.in` ownership
- Privacy policy (`apps/web/content/privacy.md`) is a working draft — lawyer review (PLAN B12)

**Next — Sprint 1 (2–6 Nov):** phone OTP auth, serviceability + waitlist, `drizzle-kit pull`, seed 3 cities + pincodes

## 2026-10-21 · Sprint 0 · session 1
**Shipped**
- Consolidated plan (`PLAN.md`), ADRs 0001–0008, OPEN-DECISIONS status, schema addendum 0002 (SA-01/02)
- `.claude/` kit: settings, guard/format/session-end, 7 agents, 3 skills; scoped CLAUDE.md files
- Root workspace, packages (config, utils, contracts, design-tokens, stubs), Docker compose, API boot skeleton + migration runner

**Stubbed / not started**
- `apps/client`, `pro`, `admin`, `portal`, `web` are placeholder workspaces (scaffolded in their sprints)
- Legal-pages site — blocked on OD-06 / OD-09

**Next**
- Darshil: answer PLAN §8 Q1–Q4; file long-lead items B1–B11
- S0 close-out: legal-pages site (Stop hook already enabled)
- S1: auth (phone OTP) + serviceability + `drizzle-kit pull`

**Found this session**
- SA-11 BLOCKER: spec schema could not be applied to Postgres (`scheduled_end` generated column). Patched via `spec-patches.ts`; fold into schema v2.
- Host already runs Postgres on 5432 → Docker DB is on **5433**.

**Known issues**
- Festival dates for lunar festivals are PROVISIONAL (ADR-0005) — verify before T&C publish
