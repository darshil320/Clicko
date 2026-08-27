# CLICKCO — REPO & PRODUCTION ARCHITECTURE
**Monorepo structure, locked versions, the patterns that matter**
Doc 2 of 3 · 27 Aug 2026

---

## 1. One important correction to the earlier spec

I recommended "on-site proxy upload before leaving the venue" and mandated heavy background upload in the Pro app. Thinking it through properly: **the photos aren't on the phone.** A photographer shooting a 2-hour event on a mirrorless body has 612 RAW files on SD cards. Getting them to the phone means camera Wi-Fi transfer at roughly a minute per file — 10 hours for one event. Not viable.

**Consequence, and it's a good one:** the heaviest engineering problem drops off the mobile critical path entirely.

| Path | Carries | Built with |
|---|---|---|
| **Web upload portal** (primary, ~99% of bytes) | All RAW, all JPEG, all video | Next.js + resumable multipart. Photographer's laptop, broadband, card reader. |
| **Pro app upload** (secondary, tiny) | 2–3 proof-of-attendance shots at check-in | Simple single-file upload. No background service, no chunking, no tus. |

So: **build the web upload portal properly and keep the app's upload trivial.** Card-loss risk in transit is covered by mandatory dual-card recording plus a 6-hour upload deadline, not by on-site upload.

This removes `react-native-background-upload`, custom dev clients for native upload modules, iOS background session handling, and Android foreground-service work from your build. Roughly two weeks saved and a large class of platform-specific bugs avoided.

---

## 2. Locked versions

Verified current as of August 2026. Pin these in the root `package.json` and don't let Claude Code drift them.

### Mobile
| Package | Version | Note |
|---|---|---|
| Expo SDK | **56** | Released 21 May 2026 |
| React Native | **0.85** | New Architecture is mandatory from SDK 55+; `newArchEnabled: false` is ignored |
| React | **19.2** | |
| expo-router | v6+ (SDK 56 line) | File-based routing, Stack v5, data loaders |
| nativewind | 4.x | Tailwind classes in RN — the bridge from Stitch output |
| @tanstack/react-query | v5 | **All server state.** Non-negotiable. |
| zustand | 5.x | Client-only state: auth session, theme, upload queue UI |
| react-hook-form + zod | current | Forms and validation |
| react-native-mmkv | current | ~30× faster than AsyncStorage; Query persistence + session |
| react-native-reanimated | 4.x | |
| expo-location, expo-notifications, expo-image-picker, expo-secure-store | SDK 56 line | |

> **Do not add Redux.** TanStack Query plus Zustand covers roughly 95% of what Redux was used for, at a fraction of the code. Adding Redux to this stack in 2026 is a self-inflicted wound.

### Backend
| Package | Version |
|---|---|
| NestJS | 11+ (verify latest at scaffold time) |
| PostgreSQL | 16+ with **PostGIS** |
| Prisma | latest — with `$queryRaw` for the 3–4 PostGIS distance queries |
| Redis | 7+ |
| BullMQ | latest — SLA clocks, dispatch cascade, payouts, Drive uploads |
| zod | shared with frontend via `packages/contracts` |

### Web
| Package | Version |
|---|---|
| Next.js | App Router, current stable |
| shadcn/ui + Tailwind | latest |
| @tanstack/react-query + react-table | v5 / v8 |

### Tooling
Turborepo · pnpm workspaces · TypeScript 5.x strict · Biome (faster than ESLint+Prettier, one config) · Vitest · Playwright · Maestro (RN E2E)

---

## 3. Monorepo tree

```
clickco/
├── CLAUDE.md                        ← root agent instructions (Doc 3)
├── turbo.json
├── pnpm-workspace.yaml
├── biome.json
├── tsconfig.base.json
├── .env.example
│
├── docs/
│   ├── DESIGN.md                    ← design system, read by Claude + Stitch
│   ├── ARCHITECTURE.md              ← this document
│   ├── DOMAIN.md                    ← booking state machine, entity glossary
│   ├── DECISIONS/                   ← ADRs, one file per decision
│   │   ├── 0001-drive-over-r2.md
│   │   ├── 0002-principal-not-marketplace.md
│   │   ├── 0003-raw-only-no-editing-in-sla.md
│   │   └── 0004-web-portal-primary-upload.md
│   └── RUNBOOK.md                   ← on-call: quota alerts, SLA breach, stuck uploads
│
├── .claude/
│   ├── agents/                      ← subagents (Doc 3)
│   ├── skills/                      ← project skills (Doc 3)
│   └── settings.json                ← hooks, permissions
│
├── apps/
│   ├── client/                      ← Expo — consumer app
│   ├── pro/                         ← Expo — photographer app
│   ├── admin/                       ← Next.js — ops panel
│   ├── portal/                      ← Next.js — photographer web upload
│   ├── web/                         ← Next.js — marketing site
│   └── api/                         ← NestJS — the backend
│
└── packages/
    ├── contracts/                   ← ★ THE KEYSTONE. Zod schemas + inferred types.
    ├── design-tokens/               ← tokens.ts → tailwind preset + css vars
    ├── ui/                          ← React Native primitives (client + pro)
    ├── ui-web/                      ← shadcn re-exports (admin + portal + web)
    ├── api-client/                  ← typed SDK generated from contracts
    ├── utils/                        ← formatINR, dates, geo, phone
    └── config/                       ← shared tsconfig, biome, tailwind bases
```

### Why `packages/contracts` is the keystone

You have five clients talking to one API, and an AI agent writing all of them. Without a single source of truth for types, Claude will define `Booking` slightly differently in each app and you'll find out in production.

```ts
// packages/contracts/src/booking.ts
import { z } from 'zod';

export const BookingStatus = z.enum([
  'DRAFT','QUOTED','ADVANCE_PENDING','CONFIRMED','DISPATCHING','ASSIGNED',
  'EN_ROUTE','CHECKED_IN','IN_PROGRESS','CHECKED_OUT','UPLOADING','PROCESSING',
  'QA','BALANCE_PENDING','DELIVERED','CLOSED','CANCELLED_CLIENT',
  'CANCELLED_PRO','PRO_NO_SHOW','ACCESS_DENIED','UNSAFE_SITE','DATA_LOSS',
  'QUALITY_ESCALATION','ABANDONED',
]);

export const PriceSnapshot = z.object({
  rulesetVersion: z.string(),
  baseAmount: z.number().int(),        // paise. always paise.
  hours: z.number(),
  emergencyMultiplier: z.number(),
  surgeMultiplier: z.number(),
  addons: z.array(z.object({ code: z.string(), label: z.string(), amount: z.number().int() })),
  travelAmount: z.number().int(),
  subtotal: z.number().int(),
  gstAmount: z.number().int(),
  total: z.number().int(),
});

export const Booking = z.object({
  id: z.string().uuid(),
  reference: z.string(),              // CLK-4821
  status: BookingStatus,
  price: PriceSnapshot,
  // …
});

export type Booking = z.infer<typeof Booking>;
```

The API validates with these schemas. The clients infer types from them. The admin panel uses the same enum. Change the state machine in one place and every surface fails to compile until it's updated — which is exactly what you want.

**Money rule, enforced by type:** every monetary value is `z.number().int()` in **paise**. No floats anywhere near money, ever. `₹8,500` is `850000`. Put this in CLAUDE.md as a hard rule.

---

## 4. Mobile app structure (`apps/client`)

Expo Router for routes, feature-sliced everything else.

```
apps/client/
├── app/                             ← routes ONLY. no business logic.
│   ├── _layout.tsx                  ← providers: Query, Zustand hydrate, theme
│   ├── (auth)/
│   │   ├── phone.tsx
│   │   ├── otp.tsx
│   │   └── profile.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── index.tsx                ← home
│   │   ├── bookings.tsx
│   │   ├── help.tsx
│   │   └── profile.tsx
│   ├── plan/[tier].tsx
│   ├── book/
│   │   ├── configure.tsx
│   │   ├── review.tsx
│   │   └── confirmed.tsx
│   ├── booking/[id].tsx
│   └── waitlist.tsx
│
├── src/
│   ├── features/                    ← one folder per domain slice
│   │   ├── booking/
│   │   │   ├── api.ts               ← calls via packages/api-client
│   │   │   ├── hooks.ts             ← useBooking, useCreateBooking (TanStack)
│   │   │   ├── store.ts             ← Zustand: in-progress booking draft
│   │   │   ├── components/
│   │   │   └── lib/                 ← pure functions, unit tested
│   │   ├── auth/
│   │   ├── delivery/
│   │   ├── tracking/
│   │   └── serviceability/
│   │
│   └── shared/
│       ├── components/              ← app-specific composites
│       ├── hooks/
│       └── lib/
│
├── app.config.ts                    ← Expo config, env-driven
├── eas.json                         ← dev / preview / production profiles
└── global.css                       ← NativeWind entry
```

### The one architectural rule that keeps this clean

```
app/         →  may import from  features/, shared/, packages/
features/X   →  may import from  shared/, packages/
features/X   →  may NOT import from features/Y        ← the important one
shared/      →  may import from  packages/  only
packages/    →  may NOT import from apps/
```

Two features never import from each other. If `booking` needs something from `delivery`, that something belongs in `shared/` or `packages/`. Enforce it with a Biome rule and a PreToolUse hook (Doc 3) — Claude will violate this constantly if you only write it down.

---

## 5. Backend structure (`apps/api`)

```
apps/api/src/
├── main.ts
├── app.module.ts
│
├── modules/
│   ├── auth/                        ← phone OTP, JWT, refresh, RBAC guards
│   ├── users/
│   ├── photographers/               ← profiles, KYC, certifications, availability
│   ├── serviceability/              ← pincodes, zones, waitlist
│   ├── pricing/                     ← ★ rules engine + snapshot generator
│   ├── bookings/                    ← ★ state machine lives here
│   ├── dispatch/                    ← ★ cascade, matching, Redis locks, PostGIS
│   ├── assignments/                 ← check-in/out, extensions, waiting logs
│   ├── media/                       ← ★ storage port + Drive adapter + JPEG worker
│   ├── delivery/                    ← link issuance, revocation, retention jobs
│   ├── payments/                    ← Razorpay orders, webhooks, refunds
│   ├── payouts/                     ← vendor invoices, TDS, batches
│   ├── ledger/                      ← ★ append-only double-entry
│   ├── sla/                         ← BullMQ clocks, breach ladder
│   ├── notifications/               ← WhatsApp, FCM, SMS, masked calling
│   ├── reviews/
│   ├── disputes/
│   └── admin/                       ← ops-only endpoints, scoped RBAC
│
├── common/
│   ├── guards/          roles.guard.ts, city-scope.guard.ts
│   ├── interceptors/    audit-log.interceptor.ts, idempotency.interceptor.ts
│   ├── filters/
│   ├── decorators/      @Idempotent(), @Roles(), @CityScoped()
│   └── pipes/           zod-validation.pipe.ts  ← uses packages/contracts
│
├── infra/
│   ├── prisma/          schema.prisma, migrations/, seed.ts
│   ├── redis/
│   ├── queues/          ← every BullMQ queue + processor registered here
│   └── storage/         ← the port and its adapters
│
└── jobs/
    ├── sla-clock.processor.ts
    ├── dispatch-cascade.processor.ts
    ├── drive-upload.processor.ts
    ├── jpeg-export.processor.ts
    ├── raw-purge.processor.ts        ← delivery + 7d, PERMANENT delete
    ├── link-revoke.processor.ts      ← delivery + 30d
    ├── quota-monitor.processor.ts    ← Drive at 60/75/90%
    └── integrity-audit.processor.ts  ← weekly file-count reconciliation
```

### Module rules

Each module owns its Prisma models and exposes a service. **Modules talk through injected services or domain events, never by reaching into another module's repository.** Booking doesn't query the photographer table directly; it asks `PhotographersService`.

Every state transition emits a domain event. `booking.checked_out` triggers the SLA clock, the upload reminder, and the client notification — three subscribers, zero coupling. This is what makes the SLA machine maintainable instead of a tangle of if-statements.

---

## 6. The storage port — your migration insurance

This is the two days that saves you a quarter. Write it before any media code.

```ts
// apps/api/src/infra/storage/storage.port.ts
export interface StoragePort {
  createUploadSession(input: {
    bookingId: string;
    fileName: string;
    sizeBytes: number;
    contentType: string;
    kind: 'RAW' | 'JPEG' | 'VIDEO' | 'PROOF';
  }): Promise<{ sessionId: string; uploadUrl: string; expiresAt: Date }>;

  completeUpload(sessionId: string, checksum: string): Promise<StoredObject>;
  abortUpload(sessionId: string): Promise<void>;

  createDeliveryLink(bookingId: string, kind: 'RAW' | 'JPEG' | 'VIDEO',
                     expiresAt: Date): Promise<{ url: string; linkId: string }>;
  revokeDeliveryLink(linkId: string): Promise<void>;

  permanentlyDelete(objectIds: string[]): Promise<void>;   // NOT trash
  getUsage(): Promise<{ usedBytes: number; limitBytes: number }>;
  listObjects(bookingId: string): Promise<StoredObject[]>;
}
```

`GoogleDriveAdapter` implements it now. `R2Adapter` implements it when you hit the tripwire. Nothing else in the codebase knows which one is live.

**Drive adapter must handle, or you will lose data:**

| Concern | Requirement |
|---|---|
| Permanent delete | `files.delete`, never `files.update{trashed:true}`. Trash consumes quota for 30 days. |
| Rate limits | Every call through a BullMQ queue with exponential backoff on `403 rateLimitExceeded` and `429`. Drive will throttle you. |
| Daily upload ceiling | Track bytes uploaded per rolling 24h in Redis. Refuse new upload sessions past 85% and alert ops. |
| Checksum verification | Compare local MD5 to Drive's returned `md5Checksum` on every file. Mismatch → re-upload, don't mark complete. |
| Service account | Shared Drive, service-account owned. Never a personal Drive. |
| Folder structure | `/Clickco/{YYYY-MM}/{booking_ref}/{Photos-JPEG|Photos-RAW/part-NN|Video}/` |
| RAW sub-folders | Split at ≤2 GB. Drive's server-side zip fails on large folders. |

---

## 7. Web upload portal (`apps/portal`) — the piece that must not fail

Four screens, but it carries 99% of your bytes and every SLA breach traces back here.

```
apps/portal/
├── app/
│   ├── login/page.tsx               ← phone OTP, same auth as Pro app
│   ├── jobs/page.tsx                ← jobs awaiting upload, deadline countdown
│   ├── jobs/[id]/upload/page.tsx    ← the uploader
│   └── jobs/[id]/status/page.tsx    ← processing + verification status
└── src/features/upload/
    ├── uploader.ts                  ← chunking, concurrency, retry, resume
    ├── use-upload-queue.ts
    └── components/
```

**Requirements, from the 2026 production standard for large-file resumable uploads:**

| Requirement | Detail |
|---|---|
| Chunked | Multipart, 8–16 MB parts for broadband (small 500 KB chunks are the mobile pattern; on a laptop they add needless overhead) |
| Checkpointed | Persist completed part numbers to IndexedDB. Closing the tab must not restart an 18 GB upload. |
| Resumable | On load, detect an incomplete session and offer Resume |
| Concurrency-limited | 4 parallel parts. More saturates Indian upload bandwidth and increases failure rate. |
| Exponential backoff | On 5xx/429: 1s, 2s, 4s, 8s, 16s, then surface to the user |
| Integrity | Per-file checksum client-side, verified server-side. Declared file count vs received count reconciled before the job can be marked uploaded. |
| Honest progress | Bytes and files, plus an ETA. A photographer watching an 18 GB upload needs to trust the number. |
| Deadline visible | Live countdown to the 6-hour deadline, with what happens if missed |
| Folder drop | Drag a whole card folder. Filter to known RAW/JPEG/video extensions, reject the rest with a clear message. |

The uploader talks to your API, never to Drive. Your API holds the credentials and does the Drive write from a queue. This is what makes the eventual R2 swap invisible to the photographer.

---

## 8. Environment and config

```
.env.example                  ← committed, every key, no values
apps/api/.env                 ← gitignored
```

Load through a Zod-validated config module that **fails at boot** on a missing or malformed variable. Never `process.env.FOO` inline in a service — it fails at 3am instead of at startup.

```ts
// apps/api/src/config/env.ts
export const env = EnvSchema.parse(process.env);  // throws on boot. good.
```

Secrets: AWS Secrets Manager or Doppler. Never in the repo, never in `app.config.ts`, and never in `EXPO_PUBLIC_*` — anything with that prefix ships inside the app bundle and is readable by anyone who downloads it.

---

## 9. What not to do

| Don't | Why |
|---|---|
| MongoDB | Financial ledger, price snapshots, double-booking prevention, geo queries. This is textbook relational. |
| Redux | TanStack Query + Zustand. Nothing here needs Redux. |
| Direct Drive access for photographers | You lose integrity checking, quota control, and any migration path |
| Floats for money | Integer paise everywhere. Enforce in `packages/contracts`. |
| Business logic in `app/` route files | Routes compose; features decide |
| Cross-feature imports | The rule that stops a monorepo becoming a tarball |
| `newArchEnabled: false` | Ignored from RN 0.82+; remove it from any config Claude generates |
| Skipping the storage port | The single highest-leverage two days in this build |
| Building offline-first everywhere | Only the Pro app's check-in/out/extension events need offline. Everything else is online-only. Offline-first is a large tax; pay it only where it's load-bearing. |
| One `.claude/CLAUDE.md` for the whole monorepo | Scoped per-app CLAUDE.md files (Doc 3). One global file gets ignored. |
