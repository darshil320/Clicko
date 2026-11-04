# CLICKCO — HANDOVER (2 Nov 2026)

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
| **S11** | **Nearly done.** Plan and as-built notes in ADR-0027 (D2/D3a, D4a, D5a, D6b). Left: the D5 app screens (section 3) and the follow-ups in section 4. |
| S12 | **Code side done** (ADR-0029): deploy files + docs/DEPLOY.md, ErrorReporter and analytics ports, k6 load tests, dry-run script (18 steps pass locally), RUNBOOK, store listings, MSG91 OTP SMS. Gate (T&C v2, Grievance Officer, D-U-N-S/Apple) still open. |

## 3. Where the last session stopped
Committed and pushed on `main`, in order:
- `48dc117` perf: indexes (0014), outbox claim-then-deliver, pool limits, caches, polling
  back-off (ADR-0027 D6b).
- `e724868` notifications pipeline, push tokens, preferences, masked calls (0015; D2/D3a).
- `341b394` reviews, reports, blocks, moderation desk (0016; D4a).
- `caede31` empty, error and offline states on every client and Pro screen (packages/ui
  `StateView`, `ErrorState`, `OfflineBanner`).
- `b588b9c` payouts for undelivered shoots, Pro paid transfers, client care and money endpoints,
  admin Refund and Issue credit sheets (0017; D5a).
- `5052515` queue shutdown waits for repeatable-job registration (fixed a flaky full API run).
- `f73383c` outbox delivery limit and claim token (0018), Redis throttler storage, ticket and
  payout-hold messages.

**Possibly uncommitted:** the client and Pro screens for the D5 endpoints (booking "Refunds &
credits", "Report a problem with my photos", "Get help" tickets, Pro "Paid" transfers). An agent was
building them when this was written. Run `git status`; if they are there, verify (typecheck, tests,
biome) and commit them.

**Not on GitHub:** the CI workflow sits on the local branch `ci-workflow`. The `darshil320` token has
no `workflow` scope, so GitHub refuses it. Once the owner runs
`gh auth refresh -h github.com -s workflow --user darshil320`, push it with
`git checkout ci-workflow && git rebase main && git checkout main && git merge --ff-only ci-workflow`
and the push command in section 6. Until then, never commit `.github/` on main, or every later
push fails.

**Checks:**
```bash
cd /Users/darshillashkari/Desktop/documents/Clickco && git status --short
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$HOME/.nvm/versions/node/v20.19.5/bin:$PATH"
npx turbo run typecheck --output-logs=errors-only && npx biome check .
cd apps/api && TEST_DATABASE_URL=postgres://clickco:clickco_local_only@localhost:5433/clickco npx vitest run --maxWorkers=2
```
Last full run: API 1,700 tests green (3 runs in a row), typecheck 17/17.

**Launch gaps found in S12 (code, no owner input needed):**
- A paid booking cannot be cancelled by anyone, so the T&C refund ladder is unreachable.
- The client app has no account deletion (Apple guideline 5.1.1(v); DPDP).
- No staff route reaches DATA_LOSS.
- **Uncommitted:** the D5 app screens (booking money section, support tickets, Pro paid transfers)
  are half-done in apps/client and apps/pro. The owner stopped that agent; ask before finishing or
  discarding them.

**Owner-gated launch blockers:** the Google Drive storage adapter is a stub (needs Google Workspace
+ Shared Drive, gate S7); approve `@sentry/node`, `@sentry/react-native`, `posthog-react-native`,
`react-native-razorpay` and `expo-notifications`; `clickco.in` DNS does not resolve yet.

## 4. S11 and S12 — what is left
- **Mobile push and call buttons:** need **`expo-notifications`** (asked, **not yet approved**).
  The server side is done. Then: register the push token on sign-in, and add call buttons in the
  client booking and the Pro job screens (`calls.start`).
- **Notification gaps:** no events or templates yet for ticket acknowledged/resolved, the Pro
  assignment reminder, `ticket.raised`, `payout.withheld`/`payout.released`, and a WARN from
  moderation. Expo push receipts are not checked yet.
- **D4 left:** reporting a message (there is no in-app messaging); unhide; PRO_TO_CLIENT reviews;
  the client rating screen and the report/block buttons in the apps.
- **D5 left:** a staff route that confirms DATA_LOSS; a payout rule for ABANDONED bookings.
- **Security follow-ups (ADR-0027 D6a/D6b):**
  - ~~a page for `/d/:token`~~ done 2 Nov (ADR-0027 D6c: apps/web `/d/<token>`, uncommitted);
  - ranged downloads;
  - check in a browser that a KYC PDF opens;
  - web CSP hashes instead of `unsafe-inline`;
  - one full-history gitleaks scan.
- **S12 left:** run k6 (not installed locally), the 10 staff dry runs on a dev-mode VM, the EAS
  production builds and store submission (accounts first).

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
  first, then a byte-identical migration. Next free number: **0019**.
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
| GitHub | `gh auth refresh -h github.com -s workflow --user darshil320` so the CI workflow can be pushed. |
| Payouts | Confirm the undelivered-shoot payout amounts (ADR-0027 D5a) and the ABANDONED rule. |
| Penalties | Amounts for no-show and late cancellation (flat per type?). Today they deduct nothing. |
| CA | GST on credit notes issued after the s.34(2) deadline. |
| CA | TDS on gross vs net. |
| CA | Payments to GST-registered photographers. |
| Legal | Registered address, Grievance Officer (OD-06/09). Legal pages show "Draft" until then. |
| Waitlist | Cloudflare Turnstile CAPTCHA needs his Cloudflare account. |
| Providers | WhatsApp templates (Meta), DLT headers/templates, Exotel KYC, Razorpay live keys, FCM/APNs credentials. |
| Production env | Before deploy: `BANK_ACCOUNT_KEY`, `DELIVERY_LINK_KEY`, `MEDIA_WORKER_ISOLATED=true` + a separate media worker, a `clickco_api` DB role (apps/api/CLAUDE.md "Database roles"), strong `JWT_ACCESS_SECRET` / `OTP_HASH_PEPPER`, `PUBLIC_WEB_URL` (the website's https origin; the API refuses to boot without it, ADR-0027 D6c). |
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
