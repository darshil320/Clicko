# CLICKCO — HANDOVER (31 Oct 2026)

Read this first in a new chat, then `CLAUDE.md`, `docs/PROGRESS.md` (newest first), and the ADRs it
names. This file is the shortest path back to full context.

## 1. What Clickco is
On-demand professional photography booking for India (Surat live, Mumbai, Vadodara pilot).
Turborepo + pnpm monorepo:

| Path | What |
|---|---|
| `apps/api` | NestJS 11 + Postgres 16/PostGIS + Redis + BullMQ |
| `apps/client` | Customer Expo app (SDK 56) |
| `apps/pro` | Photographer Expo app |
| `apps/portal` | Photographer upload portal (Next.js, :3002) |
| `apps/admin` | Staff panel (Next.js 16, :3001) |
| `apps/web` | Marketing site, static export on Vercel: https://clickco-web.vercel.app |
| `packages/*` | `contracts` (Zod), `api-client`, `design-tokens`, `ui` (React Native), `ui-web` (shadcn on Tailwind 4), `utils` |

- GitHub: github.com/darshil320/Clicko (**public**). `main` auto-deploys `apps/web` to Vercel.
- Owner: Darshil. He wants decisions taken for him (recorded as ADRs) and only owner-only questions
  asked. Reply in short "caveman" style; write code and commits normally.

## 2. Sprint status (PLAN.md §2)
| Sprint | State |
|---|---|
| S0–S8 | Done: foundations, auth, pricing, bookings and payments, client app, dispatch, Pro app (API + Expo app), upload portal, delivery and SLA. |
| S9 | Done: staff admin foundation. Password + mandatory TOTP sign-in, role and city guards, audit log, ops desks (ADR-0025). |
| S10 | Done: money (refunds four-eyes, GST credit notes, review settlement, credits, breach remedies), payouts + TDS 194C, supply (onboarding, KYC, directory, waivers), care (quality issues, tickets, equipment claims), pricing editor, "Today" home, ⌘K, grouped nav, password lifecycle (ADR-0026). |
| Security | Done: whole-app audit (4 reviewers); every CRITICAL/HIGH fixed with tests; committed and pushed (`613a935`). See ADR-0027 D6/D6a. |
| **S11** | **In progress.** Plan in ADR-0027. Two background jobs were running when this chat ended (section 3). |
| S12 | Not started: launch prep (EAS builds, store listings, Sentry/PostHog, load test, runbook, dry runs). |

## 3. Uncommitted work in the tree right now (check before anything else)
Two agents were mid-task when this handover was written. Their files are on disk, **not committed**.
1. **Performance fixes.**
   - DB indexes: migration `0014_performance_indexes.sql`.
   - Outbox: claim a batch, then deliver outside the transaction.
   - DB pool size and timeouts.
   - Quote ruleset cache; overview cache (Redis, 20 s).
   - Payout UTR batch check; scrypt concurrency cap.
   - Frontend polling back-off (Pro offers, portal), web video preload and cache headers, client
     draft debounce, per-second clock components, admin `maxPages: 3`, Pro focus gating.
   - A `.github/workflows/ci.yml`: biome, typecheck, tests, `pnpm audit`, secret scan.
2. **S11 notifications foundation** (`apps/api/src/modules/notifications`, migration
   `0015_notifications_calls.sql`):
   - WhatsApp, SMS and push ports, each with a console adapter plus a real one (Meta Cloud API,
     MSG91 DLT, Expo push).
   - Versioned templates per lifecycle event; a BullMQ send queue; WhatsApp→SMS fallback; quiet
     hours 21:00–08:00 IST; opt-outs.
   - Tables `notification_sends`, `device_push_tokens`, `notification_preferences`.
   - Push-token and preference endpoints.
   - Masked calls (Exotel port).

**First thing in the new chat:**
```bash
cd /Users/darshillashkari/Desktop/documents/Clickco
git status --short            # see what the two jobs left
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
npx turbo run typecheck --output-logs=errors-only
cd apps/api && TEST_DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco npx vitest run --maxWorkers=2
```
- Finish anything half-done: missing files, failing tests, migrations.test.ts listing 0014/0015,
  byte-identical addenda in `docs/schema-addenda/`.
- Then commit in concern-sized pieces (perf; notifications) and push (section 6).

## 4. S11 — what is left (ADR-0027)
- **D2 finish:** wire every lifecycle template to its domain event and close any gaps the
  notifications job reports; e2e test `apps/api/src/notifications.e2e.test.ts`.
- **Mobile push:** needs the **`expo-notifications`** dependency (asked, **not yet approved**).
  Until then the server side exists and the apps don't register tokens.
- **D3 masked calls:** finish the Exotel binding lifecycle (open at assignment, close 2 h after
  check-out) and the call buttons in the client and Pro apps.
- **D4 reviews and UGC:**
  - 1–5 rating after delivery, editable 7 days, feeds photographer metrics;
  - reporting of reviews, messages and users, with a moderation desk in admin (QM/support);
  - a client can block a photographer from dispatch;
  - links and phone numbers stripped from public text.
- **D5 carry-overs:**
  - in-app support ticket and quality-issue entry points;
  - refunds and credits visible on the client booking;
  - admin booking page Refund / Issue credit buttons;
  - payouts for undelivered shoots (DATA_LOSS, ACCESS_DENIED, CLIENT_ABSENT);
  - Pro earnings showing paid payouts with TDS;
  - empty, error and offline states on every client and Pro screen.
- **Security follow-ups (ADR-0027 D6a):**
  - a page for `/d/:token`, which now returns a JSON file list;
  - ranged downloads for big RAW files;
  - check in a browser that a KYC PDF opens from the admin blob link;
  - a Redis-backed throttler before running more than one API instance.

## 5. Local environment
- **Node:** Node 22 is pinned. The default `node` on PATH is Zed's Node 24, so always prefix the
  PATH as above. pnpm 11.4 lives under the Node 20 nvm folder and `~/Library/pnpm`.
- **Docker:** Postgres/PostGIS on **5433** (`postgres://clickco:clickco_local_only@localhost:5433/clickco`),
  Redis on **6380**. Docker Desktop may be off: `open -a Docker`, then
  `docker start clickco-postgres-1 clickco-redis-1`.
- **Full API suite:** must run with `--maxWorkers=2`; it times out at default parallelism.
- **Disk:** often near full. If tests or Docker hang, free space (old Expo caches, `.next`).
- **Migrate the dev DB:** `cd apps/api && pnpm db:migrate`. Dev data:
  `pnpm db:seed:dev` (dev staff + demo photographers).
- **Run the API (build first):**
  ```bash
  cd apps/api && npx nest build && CORS_ORIGINS=http://localhost:3001,http://localhost:3002,http://localhost:8081,http://localhost:8082 node --env-file=.env dist/main.js
  ```
  The local `apps/api/.env` already has `DEV_TOOLS=on` and a random `SANDBOX_WEBHOOK_SECRET`; both
  are required now.
- **Other apps:** admin `pnpm --filter @clickco/admin dev` (:3001); Pro web
  `pnpm --filter @clickco/pro web` (:8082); client web (:8081); portal (:3002).
- **Staff sign-in (dev only):** `super-admin@clickco.test` / `clickco-dev-staff-only`. Get the code
  with `pnpm --filter @clickco/api staff:totp super-admin@clickco.test`. Other roles: city-manager@,
  ops@, quality@, support@, finance@, read-only@ (`@clickco.test`).
- **Photographer sign-in (dev):** +919999000101 (Hetal Patel), code via `GET /dev/otp/<phone>`.
- **Stop hook:** `.claude/scripts/session-end.js` runs typecheck + tests on every stop. It fails
  while work is half-done; that is expected mid-task.

## 6. Pushing
The keychain git user (`darshil321`) gets a 403. Push with:
```bash
T=$(gh auth token --user darshil320) && git -c credential.helper= -c "credential.helper=!f() { echo username=darshil320; echo password=$T; }; f" push origin main
```
- The repo is public: grep the outgoing diff for keys before pushing.
- Never commit `apps/web/AGENTS.md` or `.claude/launch.json` (the owner's untracked files).

## 7. Rules that matter (full list in CLAUDE.md and apps/*/CLAUDE.md)
- **Money and data:** integer paise only; domain types from `packages/contracts`; no raw
  colours/spacing (design tokens); compose `packages/ui` / `ui-web`.
- **Every money route:** idempotent.
- **Every state change:** emits an outbox event in the same transaction.
- **Specs:** `docs/clickco-*.md/.sql` are read-only. New tables go to `docs/schema-addenda/NNNN`
  first, then a byte-identical migration. Next free number: **0016**.
- **Admin routes:** StaffGuard + `@Roles` + city scope + `@Audited` + `AuditService.record` in the
  same transaction. The desk list and role matrix live only in
  `packages/contracts/src/admin-desks.ts`.
- **Owner approval needed for:** new npm dependencies, pinned-version changes, anything only the
  owner can decide.
- **Working style:** plan large work as an ADR; test-first in money/booking/dispatch modules; run
  the security-reviewer and domain-guardian agents after sensitive changes; one concern per
  commit; update `docs/PROGRESS.md` at the end of each session.
- **Parallel agents:** they hit the account rate limit. Use at most 2–3 at a time, give each its
  own files and migration number, and resume a stopped one with SendMessage.

## 8. Waiting on the owner or the CA
| Topic | Question |
|---|---|
| Mobile push | Approve `expo-notifications`. |
| Penalties | Amounts for no-show and late cancellation (flat per type?). Today they deduct nothing. |
| CA | GST on credit notes issued after the s.34(2) deadline. |
| CA | TDS on gross vs net. |
| CA | Payments to GST-registered photographers. |
| Legal | Registered address, Grievance Officer (OD-06/09). Legal pages show "Draft" until then. |
| Waitlist | Cloudflare Turnstile CAPTCHA needs his Cloudflare account. |
| Providers | WhatsApp templates (Meta), DLT headers/templates, Exotel KYC, Razorpay live keys, FCM/APNs credentials. |
| Production env | Before deploy: `BANK_ACCOUNT_KEY`, `DELIVERY_LINK_KEY`, `MEDIA_WORKER_ISOLATED=true` + a separate media worker, a `clickco_api` DB role (apps/api/CLAUDE.md "Database roles"), strong `JWT_ACCESS_SECRET` / `OTP_HASH_PEPPER`. |
| Vercel | `NEXT_PUBLIC_API_URL` must be https://api.clickco.in or the web deploy fails on purpose. |

## 9. Key decision records
| ADR | Topic |
|---|---|
| 0013 | On-site rules |
| 0014 | Media and upload |
| 0016 | Delivery and SLA |
| 0017 | White theme |
| 0024 | Pro app (offline queue) |
| 0025 | Staff admin (S9) |
| 0026 | Sprint 10 (standard-practice money and tax decisions) |
| 0027 | Sprint 11 plan + security hardening |

`docs/SPEC-AUDIT.md` holds the spec gaps; `docs/OPEN-DECISIONS.md` holds the owner questions.
