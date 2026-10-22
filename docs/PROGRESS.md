# PROGRESS

Updated at the end of every session. Newest first.

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
