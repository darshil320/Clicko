# CLICKCO — CONSOLIDATED DELIVERY PLAN

**Synthesised from:** `clickco-v0.2-locked-spec.md`, `clickco-terms-conditions-v2.md`, `clickco-01` … `clickco-06`, `DOMAIN.md`, `SPEC-AUDIT.md`, `OPEN-DECISIONS.md`.
**Plan date:** 21 Oct 2026 · **Owner:** Darshil · **Status:** Sprint 0 in progress

Where the source docs disagree, this plan follows the *later* document and records why in §7. The `docs/clickco-*` files stay read-only; this file and `docs/DECISIONS/` are where resolutions live.

---

## 1. What we are building

On-demand professional photography booking for India. Clickco is **principal / seller of record**; photographers are contracted vendors. Pan-India brand, fulfilment gated to **Surat (LIVE), Mumbai (LIVE), Vadodara (PILOT)**, everything else → waitlist.

Six surfaces, one API, one monorepo:

| Surface | Stack | Design source |
|---|---|---|
| `apps/client` — consumer app | Expo SDK 56 · RN 0.85 · React 19.2 · NativeWind | Stitch → Figma → Figma MCP |
| `apps/pro` — photographer app | same | reuse client system + 5 Stitch screens |
| `apps/portal` — photographer web upload (99% of bytes) | Next.js App Router · shadcn | none (shadcn is the design) |
| `apps/admin` — ops panel | Next.js · shadcn · react-table | none |
| `apps/web` — marketing + legal pages | Next.js | v0 / Stitch |
| `apps/api` — backend + workers | NestJS 11 · Postgres 16 + PostGIS · **Drizzle** · Redis 7 · BullMQ | — |

Keystone package: `packages/contracts` (Zod schemas → inferred types for every surface).

---

## 2. Timeline

Doc 03 sets **12 one-week sprints**, "realistically 14–16 weeks" solo with Claude Code. This plan keeps the 12-sprint schedule and holds the extra weeks as an explicit launch buffer.

| Sprint | Dates (2026–27) | Vertical slice | Demo at end |
|---|---|---|---|
| **S0** Foundations | 21 Oct – 30 Oct | Monorepo, tokens, contracts, utils, Docker, schema migration, `.claude/` kit, legal-pages site shell. **All long-lead submissions filed.** | `pnpm typecheck && pnpm test` green; DB boots with full schema |
| **S1** Auth + serviceability | 2 – 6 Nov | Phone OTP (DLT-backed SMS, dev stub until DLT clears), JWT/refresh, pincode gate, waitlist, Drizzle introspection | Log in, learn whether your pincode is served |
| **S2** Pricing engine | 9 – 13 Nov | 82-case test matrix first, then the 12-step algorithm, ruleset seed (doc 05 §5) | Quote any tier × category × city × time correctly to the paise |
| **S3** Booking + payments | 16 – 20 Nov | State machine, outbox, Razorpay orders/webhooks, auth-capture, 50/50 + banded advance, invoices, ledger, idempotency, audit log | Real ₹1 booking end-to-end |
| **S4** Client booking flow | 23 – 27 Nov | Wave 1 screens (Home → Plan → Configure → Review → Confirmed) on real APIs | Book a shoot from a phone |
| **S5** Dispatch | 30 Nov – 4 Dec | Cascade waves, PostGIS matching, Redis SETNX + EXCLUDE backstop, emergency broadcast, auto-refund timer | Booking auto-assigns to the right photographer |
| **S6** Pro app | 7 – 11 Dec | Jobs feed, accept, geofenced check-in/out (150 m), extensions, waiting logs, offline WAL queue, earnings | Full shoot on two phones |
| **S7** Upload portal + media | 14 – 18 Dec | Resumable multipart (8–16 MB parts, 4-way, IndexedDB checkpoints), StoragePort + Drive adapter, JPEG export worker, integrity audit, quota monitor | Upload 20 GB, every file verified |
| **S8** Delivery + SLA | 21 – 25 Dec | Balance payment, delivery links, all BullMQ SLA clocks, pause-at-BALANCE_PENDING, breach ladder, RAW/JPEG purge, link revoke | Shoot-to-delivery with live 48 h clock |
| **S9–10** Admin panel | 28 Dec – 8 Jan | Booking board, dispatch desk, SLA breach board, onboarding kanban, KYC queue, payouts + TDS, refunds, QM queue, pricing editor (draft → preview → publish), **grievance tickets**, **equipment claims** | Ops runs a day without SQL |
| **S11** Notifications + polish | 11 – 15 Jan | WhatsApp templates wired, FCM, Exotel masked calls, reviews, UGC reporting/blocking, empty/error states, Wave 3 screens | Every lifecycle message fires |
| **S12** Launch prep | 18 – 22 Jan | EAS production builds, store listings, Sentry + PostHog, upload load test, runbook, **10 staff dry-run bookings** | Store submission sent |
| Buffer | 25 Jan – 12 Feb | Store rejection cycle (budgeted), photographer trial shoots, fixes from dry runs | — |
| **Soft launch** | **Mon 1 Feb 2027** | Surat, invite-only | — |
| **Public launch** | **Mon 15 Feb 2027** | Surat + Mumbai LIVE, Vadodara PILOT | Catches the tail of wedding season |

### Gates — a sprint may not start until

| Sprint | Gate | Source |
|---|---|---|
| S2 | GST flag decided (✅ exclusive), rate card signed off (✅ doc 05 §5) | OD-01, OD-02 |
| S3 | Razorpay **test** keys (prod keys before S12) | doc 03 §1 |
| S4 | Figma Wave 1 cleaned up: Variables bound, Auto Layout, 10 components, Code Connect | doc 01 §6 |
| S7 | Google Workspace Shared Drive + service account provisioned | v0.2 §4 |
| S11 | WhatsApp templates approved, DLT headers approved, Exotel KYC done | doc 03 §1 |
| S12 | T&C v2 published with zero `[BRACKETS]`, Grievance Officer named, D-U-N-S + Apple org account | OD-06/09, doc 03 §1 |
| Public launch | 25 vetted photographers Surat, 20 Mumbai, 10 Vadodara; vendor agreement signed by each | v0.2 §14 |

---

## 3. Parallel non-code track (starts in S0 — pure waiting time)

These gate launch and cannot be compressed once started. **File every one in S0.** Most need the legal entity details (Q1 in §8).

| # | Item | Lead time | Must be done by | Blocks |
|---|---|---|---|---|
| B1 | Confirm company registration, PAN, GSTIN, bank account | — | S0 | B2–B7 |
| B2 | Legal-pages site live on `clickco.in` (T&C, refund, privacy, grievance) | 2 days of code | S0 end | Razorpay KYC |
| B3 | Razorpay KYC | 3–10 days | S3 (test), S12 (live) | Taking money |
| B4 | Meta Business Verification → WhatsApp Business API | 1–3 weeks | S11 | All notifications |
| B5 | Submit **all 9** WhatsApp templates at once | ~1 week after B4 | S11 | Transactional messages |
| B6 | TRAI DLT entity + header + templates | 1–2 weeks | S1 (dev stub until then), S11 | OTP SMS |
| B7 | D-U-N-S number → Apple **organisation** developer account | 1–3 weeks | S12 | iOS release |
| B8 | Google Play **organisation** account (exempt from 12-tester rule) | 2–7 days | S12 | Android release |
| B9 | Exotel account + KYC | ~1 week | S11 | Masked calling |
| B10 | Google Workspace Business Standard + Shared Drive + service account | 1 day | S7 | Media pipeline |
| B11 | Domains: `clickco.in`, `app.`, `admin.`, `upload.`, `api.` on Cloudflare; AASA + `assetlinks.json` | 1 day | S0 | Deep links (retrofit = app update) |
| B12 | Lawyer: vendor services agreement + T&C v2 review | 1–2 weeks | S6 | Photographer onboarding |
| B13 | CA consultation: GST treatment, TDS 194C vs 194J, place-of-supply | 1 hour | S2 | Pricing engine sign-off |
| B14 | Photographer sourcing → interviews → trial shoots | rolling | S6 → launch | Supply |
| B15 | Verify festival dates (Drik Panchang) for the provisional seed in ADR-0005 | 1 hour | S2 | T&C §3.2 peak-season clause |
| B16 | Design track: Stitch Prompts 1–3 → Figma cleanup → Code Connect (copy fixes per §6) | S0–S3 | S4 | Client + Pro UI |

---

## 4. Engineering workflow (how every session runs)

Per doc 03 §3–4 and doc 06:

1. **One vertical slice per session.** Commit, update `docs/PROGRESS.md`, `/clear`.
2. **Plan first** for anything touching >3 files.
3. **Test-first** in pricing, bookings, dispatch, ledger, sla, payments → `test-writer` agent prints test names, waits for approval.
4. **Reviews by subagent:** `domain-guardian` (domain modules), `schema-guardian` (DB), `contract-checker` (API surface), `security-reviewer` (auth/payments/uploads/links/PII), `design-verifier` (UI).
5. **Hooks hold the architecture:** `guard.js` blocks cross-feature imports, raw colours, storage SDKs outside adapters, float money, tables outside `infra/db`, secrets. Stop hook (typecheck + tests) is enabled once packages exist.
6. **Specs are read-only** to agents (`Write(./docs/clickco-*)` denied).

### Definition of done (every sprint)
`pnpm typecheck` clean · `pnpm test` green with new logic covered · guardian agents report no findings · every new endpoint validated by a contracts schema · every money path idempotent · UI diffed against Figma (empty table) · `PROGRESS.md` updated · ADR for significant decisions · demoable on a real device against a real backend.

---

## 5. Sprint 0 checklist

- [x] Spec audit (`SPEC-AUDIT.md`, `DOMAIN.md`, `OPEN-DECISIONS.md`)
- [x] Consolidated plan + decision log (this file, `DECISIONS/`)
- [x] Root workspace: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `.env.example`, `.nvmrc`
- [x] `.claude/` kit: settings, guard/format/session-end scripts, 7 agents, 3 skills, scoped `CLAUDE.md` files
- [x] `packages/design-tokens` from `docs/DESIGN.md` (tokens.ts → tailwind preset + CSS vars)
- [x] `packages/utils` money primitives (`roundHalfUp`, `ceilHalf`, `formatINR`) test-first
- [x] `packages/contracts`: Money, enums, PriceSnapshot, Booking, Photographer, City
- [x] `docker-compose.yml`: Postgres 16 + PostGIS, Redis 7
- [x] `apps/api` boot skeleton: Zod env, health endpoint, SQL migration runner applying `clickco-04-schema.sql` + audit addenda
- [ ] `apps/web` legal-pages site — **blocked on Q1/Q2** (entity name, Grievance Officer)
- [ ] Long-lead submissions B1–B11 — **Darshil, needs Q1**
- [ ] Stitch → Figma Wave 1 (B16)

**No feature code in S0.** `apps/client`, `apps/pro`, `apps/admin`, `apps/portal` are placeholder workspaces; each is generated in its own sprint (S4, S6, S9, S7) so the pinned toolchain is applied fresh.

---

## 6. Spec fixes adopted (audit findings → action)

| Finding | Action | When |
|---|---|---|
| SA-01 no equipment-claims surface (T&C §8.2) | `equipment_claims` table in `docs/schema-addenda/0002-spec-audit-gaps.sql` | S0 (schema), S9–10 (admin UI) |
| SA-02 no grievance surface (T&C §12, E-Commerce Rules) | `support_tickets` + `ticket_messages` with 48 h ack / 30-day resolve SLA columns in the same addendum. **Pre-launch blocking.** | S0 (schema), S9–10 (UI), S11 (in-app entry point) |
| SA-03 money `z.number().int()` overflow gap | `MoneyPaise = z.number().int().safe().min(0).max(MAX_MONEY_PAISE)`; arithmetic in `bigint`; aggregates cross the wire as `MoneyPaiseString` | S0 |
| SA-04 / SA-05 / SA-07 | Clarifications only — captured in `DOMAIN.md` and the `clickco-money` skill | — |
| SA-06 mockup extension "+₹3,800" wrong | Recompute: Professional Surat extension = ₹4,250/hr (Portrait/Event) or ₹4,888/hr (Food ×1.15). Fix Stitch copy before regenerating. | B16 |
| **SA-08 (new)** Screen 4 mockup: Base "₹8,500" for Professional **Food** should be ₹9,775 (×1.15); Travel 18 km should be ₹254 (₹200 + 3 km × ₹18), not ₹400 | Recompute Screen 4 / Screen 12 copy from doc 05 | B16 |
| **SA-09 (new)** `booking_price_snapshots.snapshot_totals_balance` CHECK cannot hold on the GST-**inclusive** branch (taxable is back-derived, so it ≠ base + addons + travel − discount) | Moot while `prices_include_gst = false` (ADR-0005). If inclusive is ever chosen, the CHECK must change first. Recorded so nobody flips the flag blind. | — |
| **SA-10 (new)** Plan copy "60 edited-quality frames per hour" contradicts "no editing in SLA" and undercuts Clickco Edit | Change to "60 delivered frames per hour" in Stitch copy | B16 |

---

## 7. Cross-doc conflicts resolved

| Conflict | Resolution | Basis |
|---|---|---|
| ORM: doc 02 Prisma vs schema §15 Drizzle | **Drizzle**, introspected from the SQL. SQL is the source of truth. | schema §15, doc 06 H.1 |
| Upload: v0.2 "on-site proxy upload" vs doc 02 web portal | **Web portal primary**; Pro app uploads proof shots only | doc 02 §1, doc 06 H.2 |
| Sprint order: v0.2 §14 (backend → pro → client) vs doc 03 §5 (vertical slices) | **Doc 03 vertical slices** — later document, every sprint demoable | doc 03 is dated after v0.2 |
| Advance % under 24 h (v0.2 §15.4 open) | **Doc 05 §8 table**: SAME_DAY/HOURS_3_8 100% upfront; HOURS_UNDER_3 authorise-only | OD-10 |
| NestJS: doc says 11; npm latest is 12.x | **Pin NestJS 11** per orchestration kit; revisit after launch | doc 06 §6 |
| TypeScript: doc says 5.x; npm latest is 7.x | **Pin TypeScript 5.9** | doc 06 §6 |
| Node: doc says 22 LTS | **Node 22** via `.nvmrc` + `engines` | doc 03 §2 |

---

## 8. Questions only Darshil can answer

Sprint 0 continues without these; each lists what it blocks.

1. **Legal entity** — exact registered name, registered address, PAN/GSTIN status. Is it a DMC Tech entity or a new company? → blocks B1–B9, T&C header, invoices (`invoice_series`).
2. **Grievance Officer** — name, email, phone, address; plus the privacy email for T&C §9.4/§11.4. → blocks T&C publish, store submission.
3. **Video at launch** — I've defaulted to **photos-only at launch** (ADR-0005). Confirm or override. → photographer gear rubric (S6), storage maths.
4. **Domain** — is `clickco.in` registered and on Cloudflare? → B11, deep links.

Decided on your behalf (override any by saying so): see `docs/DECISIONS/0005-open-decisions-resolved.md`.
