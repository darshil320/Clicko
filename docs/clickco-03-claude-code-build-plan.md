# CLICKCO — CLAUDE CODE BUILD PLAN
**Prerequisites, agent configuration, sprint-by-sprint execution**
Doc 3 of 3 · 27 Aug 2026

---

## 1. Start these TODAY — they are pure waiting time

This is the most actionable section in all three documents. Six things gate your launch and none of them can be rushed once the clock starts. All six can run in parallel with development, but only if you start them now.

| # | Item | Lead time | Blocks | Start requirement |
|---|---|---|---|---|
| 1 | **D-U-N-S number** (for an Apple *organisation* developer account) | **1–3 weeks** | iOS release entirely | Company registration docs. Free from Dun & Bradstreet. Individual accounts skip this but publish under your personal name — wrong for a brand. |
| 2 | **Meta Business Verification** → WhatsApp Business API | **1–3 weeks** | All customer notifications | Business registration, GST certificate, a website with matching domain email |
| 3 | **WhatsApp message templates** | **~1 week each**, after #2 | Every transactional message | Submit all 9 at once, not one at a time |
| 4 | **TRAI DLT registration** (transactional SMS headers) | **1–2 weeks** | OTP and SMS fallback | Mandatory in India. Entity registration + header + template scrubbing. |
| 5 | **Razorpay / Cashfree KYC** | **3–10 days** | Taking any money | PAN, GST, bank proof, business registration, website with visible T&C + refund policy |
| 6 | **Google Play Developer account** | 2–7 days, plus policy | Android release | ₹2,000 one-time. New *personal* accounts need 12 testers for 14 days before production — organisation accounts are exempt. Register as an organisation. |

**Critical dependency chain:** Razorpay KYC requires a live website showing your T&C and refund policy. So the marketing site — or at minimum a legal-pages site — must exist before payments can be approved. Ship a one-page site with the policies in week one.

Apple Developer is ₹8,900/yr, Google Play ₹2,000 one-time.

---

## 2. The rest of the prerequisites

**Accounts** — Expo/EAS · GitHub org (private) · Google Workspace Business Standard (Shared Drive) · Google Cloud project (Drive API + Maps Platform, or MapMyIndia) · Firebase (FCM push) · Exotel (masked calling, needs KYC) · Sentry · PostHog · AWS or Railway · Cloudflare (DNS now, R2 later)

**Local tooling** — Node 22 LTS · pnpm · Docker (Postgres + Redis locally) · Xcode + iOS simulator (Mac required for iOS builds; EAS can build in cloud but you need a simulator to verify) · Android Studio · Claude Code · Figma desktop app (the desktop MCP server enables selection-based workflows) · `darktable-cli` or `rawtherapee-cli` on the JPEG worker

**Legal, from the earlier docs** — vendor services agreement drafted · T&C v2 finalised and published · privacy policy · refund policy · Grievance Officer named · CA consultation on GST treatment · company GST registration

**Domains** — `clickco.in` (marketing) · `app.clickco.in` (deep links, universal links) · `admin.clickco.in` · `upload.clickco.in` · `api.clickco.in`

Universal links and Android App Links need `apple-app-site-association` and `assetlinks.json` served from `clickco.in` — set this up in week one, because retrofitting deep links after launch means an app update.

---

## 3. `.claude/` configuration

Claude Code in 2026 has four customisation surfaces and they are not interchangeable. The decision rule from the official docs, condensed:

> **Must be enforced → Hook.** **Contextual knowledge → Skill.** **Delegation boundary → Subagent.** **Always-on project guidance → CLAUDE.md, kept short.**

Most people put everything in CLAUDE.md, it grows to 800 lines, and the model stops honouring the middle of it. Split it.

### 3.1 CLAUDE.md hierarchy

Scoped files, each short. Claude reads the nearest one.

```
CLAUDE.md                    ← 60 lines max. universal, non-negotiable rules.
apps/client/CLAUDE.md        ← client app conventions
apps/pro/CLAUDE.md
apps/api/CLAUDE.md
apps/admin/CLAUDE.md
packages/ui/CLAUDE.md
```

**Root `CLAUDE.md`:**

```markdown
# CLICKCO — Root Rules

Clickco is an on-demand photography booking platform for India.
Monorepo: Turborepo + pnpm. Read docs/ARCHITECTURE.md before structural work.
Read docs/DOMAIN.md before touching bookings, dispatch, or pricing.

## Non-negotiable

1. MONEY IS INTEGER PAISE. Never a float, never a Number for currency.
   ₹8,500 is 850000. Types come from packages/contracts.
2. TYPES COME FROM packages/contracts. Never redefine a domain type
   locally. If a type is missing, add it to contracts first.
3. NEVER hardcode a colour, spacing value, or font size. Use
   packages/design-tokens. If a token is missing, tell me — don't invent one.
4. NEVER create a one-off UI component. Compose from packages/ui or
   packages/ui-web. If a primitive is missing, stop and tell me.
5. features/X must NOT import from features/Y. Shared code goes to
   shared/ or packages/.
6. Every money-mutating endpoint requires an idempotency key.
7. Every state transition on Booking emits a domain event. No direct
   cross-module writes.
8. Storage access goes through StoragePort only. Never import the Google
   Drive SDK outside infra/storage/adapters/.

## Working style

- Plan before coding. For any task touching more than 3 files, write the
  plan and wait for my approval.
- One concern per commit. Conventional commits.
- Write the test first for anything in pricing/, bookings/, dispatch/,
  ledger/, or sla/. These are the modules where bugs cost money.
- After UI work: screenshot, compare to Figma, list differences, fix, re-verify.
- If a decision is architecturally significant, write an ADR in
  docs/DECISIONS/ before implementing.
- If you're unsure, ask. Do not guess and do not scaffold placeholder logic
  that looks finished.

## Never

- Never add a dependency without telling me and why.
- Never change a pinned version in package.json.
- Never use MongoDB, Redux, or AsyncStorage (use MMKV).
- Never write `newArchEnabled: false` — it's ignored in RN 0.85.
- Never commit a secret, including to .env.example.
```

**`apps/api/CLAUDE.md`** (excerpt):

```markdown
# API Rules

NestJS 11 + Prisma + Postgres/PostGIS + Redis + BullMQ.

- One module per bounded context. Modules communicate via injected services
  or domain events, never by querying another module's tables.
- Validation via ZodValidationPipe using packages/contracts schemas.
- Every admin-facing mutation passes through AuditLogInterceptor.
- Geo queries use Prisma $queryRaw with PostGIS. Isolate them in
  dispatch/repositories/ — nowhere else.
- Scheduled work is a BullMQ processor in jobs/, registered in
  infra/queues/. Never a raw setTimeout or node-cron.
- Drive API calls always go through the rate-limited queue. Never call the
  Drive SDK directly from a service.
- The ledger table is append-only. No UPDATE, no DELETE, ever.
```

### 3.2 Subagents (`.claude/agents/`)

Subagents get their own context window, which is the point — exploration and verification shouldn't pollute the main thread with failed approaches.

| Agent | Tools | Job |
|---|---|---|
| `domain-guardian` | Read, Grep, Glob | Reviews any change to bookings/pricing/dispatch/ledger/sla against docs/DOMAIN.md. Reports violations, doesn't fix. |
| `contract-checker` | Read, Grep, Glob | After any API change: verify every client using that endpoint still type-checks against packages/contracts. |
| `design-verifier` | Read, Bash, Figma MCP | Screenshots a built screen, diffs against the Figma frame, returns a difference table. |
| `test-writer` | Read, Write, Bash | Writes tests for a module in isolation. Never touches implementation. |
| `security-reviewer` | Read, Grep, Glob | Runs on anything touching auth, payments, uploads, or delivery links. Checks idempotency, authz, secret handling, IDOR on booking/link IDs. |

Example:

```markdown
---
name: domain-guardian
description: Reviews changes to bookings, pricing, dispatch, ledger or SLA modules against the documented domain rules. Use after any change in those modules, before committing.
tools: Read, Grep, Glob
model: opus
---

You are the domain integrity reviewer for Clickco.

Read docs/DOMAIN.md first, every time.

Check the changed code for:
1. Illegal state transitions — any transition not in the documented machine
2. Money handled as anything other than integer paise
3. Price computed anywhere outside the pricing module
4. A price snapshot mutated after creation (it is immutable)
5. Direct writes to another module's tables
6. A state transition that doesn't emit its domain event
7. SLA clocks started from the wrong timestamp (T0 is CHECKED_OUT, never
   booking creation)
8. Ledger rows being updated or deleted
9. Missing idempotency on a money-mutating path

Report findings as a table: severity / file:line / rule violated / suggested
fix. Do not edit files. If you find nothing, say so plainly — do not invent
findings to seem useful.
```

### 3.3 Hooks (`.claude/settings.json`)

Hooks are deterministic. Use them for the rules Claude will otherwise drift on. Block with exit code 2.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "pnpm biome check --write $CLAUDE_FILE_PATH" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [{ "type": "command", "command": "node scripts/guard-imports.js $CLAUDE_FILE_PATH" }]
      }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "pnpm typecheck && pnpm test --run" }] }
    ]
  }
}
```

`scripts/guard-imports.js` should exit 2 on: a cross-feature import, a hex colour outside design-tokens, a Drive SDK import outside the adapter, or a float used in a field named `amount|price|total|payout`. Four checks, maybe 60 lines, and they hold the architecture together far more reliably than instructions do.

### 3.4 Worth installing

- **Superpowers** (`/plugin marketplace add obra/superpowers-marketplace`) — plan-first, TDD loop, systematic debugging, subagent-driven development. The most-adopted community skill framework by a wide margin. Opinionated toward test-first; given that pricing, ledger and SLA are where bugs cost real money, that opinion suits this project.
- **Skill Creator** from Anthropic's official skills repo — for writing your own project skills.
- **Figma plugin** at `claude.com/plugins/figma`.
- Bundled: `/code-review`, `/verify`, `/run`, `/doctor`.

### 3.5 Project skills to write yourself

Three, and they pay back immediately:

| Skill | What it encodes |
|---|---|
| `clickco-domain` | State machine, money rules, SLA clock semantics, event catalogue. Loaded whenever booking logic is touched. |
| `clickco-screen` | The full procedure for building a screen from Figma: read frame → check primitives exist → build → four states → screenshot → diff → fix. |
| `clickco-module` | The NestJS module skeleton: controller, service, repository, DTOs from contracts, module registration, test file, audit interceptor. |

`clickco-screen` alone will save you from re-explaining the same eight steps forty times.

---

## 4. Context discipline

The main cause of degrading output over a long build is context rot, not model capability.

- **One task per session.** Finish the vertical slice, commit, `/clear`.
- **Push exploration to subagents.** "Find where X is handled" burns 30k tokens of dead ends in your main window. Delegate it.
- **`/compact` at phase boundaries**, not when you hit the limit. Before compacting, ask for a written handoff into a scratch file so the next session starts from a summary you can read.
- **Keep a `docs/PROGRESS.md`** that Claude updates at the end of each session: what shipped, what's stubbed, what's next, known issues. This is the single highest-value habit in an agent-driven build.
- **Never let Claude "finish" a module it can't test.** A green typecheck is not a working feature.

---

## 5. Sprint plan with opening prompts

Twelve sprints of one week. Solo with Claude Code, this is achievable but tight; assume 14–16 weeks realistically. **Every sprint ends with a working vertical slice you can demo**, not a layer.

### Sprint 0 — Foundations
Scaffold, tokens, primitives, contracts. Long-lead items submitted.

```
Set up the Clickco monorepo per docs/ARCHITECTURE.md.

Turborepo + pnpm. Create the workspace skeleton: apps/{client,pro,admin,portal,web,api},
packages/{contracts,design-tokens,ui,ui-web,api-client,utils,config}.

Pin exactly: Expo SDK 56, React Native 0.85, React 19.2. Do not upgrade or
downgrade anything.

Then, in order, stopping for my review after each:
1. tsconfig.base.json, biome.json, turbo.json, .env.example
2. packages/design-tokens from docs/DESIGN.md — tokens.ts as source of truth,
   tailwind preset and CSS vars derived
3. packages/contracts — start with Money, PriceSnapshot, BookingStatus,
   Booking, Photographer, City. Zod first, types inferred.
4. Docker compose for Postgres 16 + PostGIS + Redis
5. .claude/agents/ and .claude/settings.json hooks per docs

Do not write any feature code this sprint.
```

### Sprint 1 — Auth + serviceability
Phone OTP end to end. Pincode gate and waitlist. **Demo: open the app, log in, get told whether we serve your area.**

### Sprint 2 — Pricing engine
Versioned rules, effective dates, immutable snapshots, GST, travel zones, multipliers. **Test-first, no exceptions.**

```
Build the pricing module per docs/DOMAIN.md §Pricing.

Test-first. Write the full test suite before any implementation, covering:
- base rate resolution across plan × category × city tier
- 2-hour minimum, 30-minute increments
- all four emergency multiplier bands
- surge from the festival calendar
- night multiplier boundary conditions (21:59, 22:00, 05:59, 06:00)
- travel zones 0/1/2 including the exact 15 km and 40 km boundaries
- add-on stacking
- GST at 18% and the inclusive/exclusive switch
- rounding — always to the paise, never a float
- snapshot immutability: attempting to mutate must throw
- ruleset versioning: an old booking reprices to its original ruleset

Show me the test file first. I'll review it before you implement.
```

### Sprint 3 — Booking state machine + payments
Full lifecycle, Razorpay orders and webhooks, 50/50 invoicing, idempotency, ledger, audit log. **Demo: a real ₹1 booking end to end.**

### Sprint 4 — Client app, booking flow
Wave 1 screens against real APIs. **Demo: book a shoot from the phone.**

### Sprint 5 — Dispatch engine
Cascade waves, PostGIS matching, Redis locks, acceptance windows, emergency broadcast. **Demo: booking auto-assigns to the right photographer.**

### Sprint 6 — Pro app
Jobs feed, accept, geofenced check-in/out, extensions, waiting logs, offline queue. **Demo: complete a shoot end to end on two phones.**

### Sprint 7 — Upload portal + media pipeline
Resumable chunked upload, Drive adapter, JPEG export worker, integrity audit, quota monitor. **Demo: upload 20 GB, verify every file landed.**

### Sprint 8 — Delivery + SLA machine
Balance payment, link issuance, retention jobs, RAW purge, breach ladder, all BullMQ clocks. **Demo: full shoot-to-delivery with the 48h clock visible.**

### Sprint 9–10 — Admin panel
Booking board, dispatch desk, SLA breach board, photographer onboarding, payouts, refunds, pricing editor, quota monitor. shadcn throughout, no Figma.

### Sprint 11 — Notifications, reviews, polish
WhatsApp templates wired, FCM, masked calling, reviews, empty and error states, Wave 3 screens.

### Sprint 12 — Launch prep
EAS production builds, store listings, Sentry and PostHog, load test the upload path, 10 internal dry-run bookings, runbook written.

---

## 6. Definition of done

A sprint isn't finished until all of these are true. Write it into CLAUDE.md.

- [ ] `pnpm typecheck` clean across the monorepo
- [ ] `pnpm test` green; new logic covered
- [ ] `domain-guardian` run on any bookings/pricing/dispatch/ledger/sla change — no findings
- [ ] `security-reviewer` run on anything touching auth, payments, uploads, or links
- [ ] UI work visually diffed against Figma; difference table empty
- [ ] Every new endpoint validated by a contracts schema
- [ ] Every money path idempotent
- [ ] `docs/PROGRESS.md` updated
- [ ] ADR written if a significant decision was made
- [ ] Demoable on a real device against a real backend

---

## 7. What's still ahead — next iterations

Deliberately not covered here. Roughly in the order you'll need them:

1. **Postgres schema DDL** — full Prisma schema, all entities, indexes, PostGIS setup, constraints, seed data
2. **Pricing engine spec** — the actual rate card structure and rule-resolution algorithm
3. **Admin panel screen-by-screen** — every screen, every field, RBAC matrix
4. **Marketing site** — IA, copy, the programmatic city × category SEO structure (~96 pages), conversion flow
5. **Photographer onboarding operational playbook** — sourcing, vetting rubric, trial shoot grading, contract flow
6. **CI/CD + deploy** — GitHub Actions, EAS profiles, migration strategy, staging, rollback
7. **App store submission playbook** — listings, screenshots, review notes, the rejection reasons UGC apps actually hit
8. **Observability + runbook** — dashboards, alert thresholds, on-call procedures
9. **Load and failure testing** — the upload path specifically
10. **Unit economics model** — the spreadsheet, with the Phase 0 measurements plugged in

Say which one and I'll go as deep on it as these three.
