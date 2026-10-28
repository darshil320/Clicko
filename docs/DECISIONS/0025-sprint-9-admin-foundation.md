# ADR-0025 — Sprint 9: staff admin panel foundation and the ops desks

**Status:** Accepted 28 Oct 2026. Taken on Darshil's behalf and overridable. Darshil approved the
shadcn stack dependencies and `expo-secure-store` on 28 Oct 2026.
**Sources:**
- PLAN §2 S9–10 ("Ops runs a day without SQL"); doc 02 §API (`modules/admin`, roles and city-scope
  guards, audit interceptor); doc 03 Sprint 9–10; doc 01 ("shadcn *is* the design").
- v0.2 G-33 (audit log); schema `staff_users`, `staff_role_grants`, `refresh_tokens` (STAFF),
  `audit_logs`; DOMAIN.md staff transitions.
- ADR-0009 (audit interceptor lands in S9), ADR-0013 §staff confirmations, ADR-0016 (QA desk,
  breach attribution), ADR-0017 (white theme).

## D1 — Splitting S9–10
The two-week block is split so the ops team can run bookings first and settle money second.
- **S9 (this ADR):** staff sign-in, roles and cities, the audit log, and the ops desks:
  - booking board and booking detail;
  - QA desk;
  - incident confirmations;
  - dispatch desk;
  - SLA breach board (attribute or waive; no money moves);
  - alert feed;
  - staff management.
- **S10 (next ADR):** desks that move money or change supply:
  - refunds and credits, including review reasons such as `REFUND_DUE_*` and
    `CLIENT_NON_ATTENDANCE`;
  - breach remedies;
  - payouts + TDS (CA ruling pending — section and rate are parameters);
  - pricing editor (draft → preview → publish, FINANCE + 2FA);
  - onboarding kanban and KYC queue;
  - QM queue;
  - grievance tickets (SA-02);
  - equipment claims (SA-01);
  - penalty waivers.

## D2 — Staff sign-in
- **Credentials:** email + password + **TOTP for every staff account**. The schema requires TOTP
  only for FINANCE and above; it is required for everyone here because the panel exposes client
  phone numbers and addresses. No self sign-up.
- **Password hashing:** Node's built-in `crypto.scrypt` (N=2^15, r=8, p=1, 16-byte salt), stored
  as `scrypt$N$r$p$salt$hash`, compared with `timingSafeEqual`.
- **TOTP:** RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step) on Node `crypto`.
  - The secret is encrypted at rest with AES-256-GCM. The key is env `STAFF_TOTP_KEY` (32 bytes,
    base64), required outside test and development.
  - A code is refused if already used in its time step (replay guard in Redis).
- **Flow:**
  1. `POST /admin/auth/login` returns a 5-minute challenge, held in Redis and bound to the staff
     id:
     - `step: TOTP`, or
     - `step: ENROL_TOTP` with the secret shown once.
  2. `POST /admin/auth/totp` returns the session.
  - Wrong password, unknown email and inactive account all give the same 401.
- **Lockout:** 5 failed passwords per email per 15 min, and 20 per IP, then 429.
  - 5 failed TOTP codes burn the challenge.
- **Sessions:** the existing `TokenService` with subject kind STAFF.
  - The access token lasts 15 min; staff refresh tokens last **12 h**, not 30 days.
  - `/admin/auth/refresh` and `/admin/auth/logout` work as the Pro routes do.
  - Deactivating a staff member revokes all their sessions.
- **The first SUPER_ADMIN** is created by a CLI script, `pnpm --filter @clickco/api staff:create`.
  It prints a temporary password once; TOTP enrolment happens at first sign-in.
  - Later staff are created in the panel by a SUPER_ADMIN, also with a temporary password.
  - Development seeds one staff account per role (password documented in apps/api/CLAUDE.md,
    development only).
- **Audit:** sign-ins and failures go to `audit_logs`:
  - `staff.login`, `staff.login_failed`, `staff.totp_enrolled`;
  - `actor_email` is set even when no account matched.

## D3 — Roles and cities (server-side only)
- **Guards:**
  - `StaffGuard`: a STAFF token whose account is still active. Grants are loaded per request.
  - `@Roles(...)`: SUPER_ADMIN passes every check.
  - `@CityScoped(param)`: the booking's city must be one of the caller's grant cities (`NULL` =
    all).
  - Lists filter to the caller's cities in SQL.
- **S9 matrix** (✓ = allowed; CITY_MANAGER only within their cities):

| Desk / action | SUPER_ADMIN | CITY_MANAGER | OPS_AGENT | QUALITY_MANAGER | SUPPORT | FINANCE | READ_ONLY |
|---|---|---|---|---|---|---|---|
| Booking board + detail | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (client phone masked) |
| QA pass / fail | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Confirm incident | ✓ | ✓ | ✓ | – | – | – | – |
| Dispatch desk (view) | ✓ | ✓ | ✓ | – | ✓ | – | ✓ |
| Breach attribute / waive | ✓ | ✓ | – | ✓ | – | – | – |
| Alert feed | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Staff management | ✓ | – | – | – | – | – | – |

## D4 — Audit log (G-33)
- **Writer:** `AuditService.record(tx, entry)` writes `audit_logs` inside the action's own
  transaction, so the row and the change commit together.
  - It records actor, action (`qa.decide`, `incident.confirm`, `breach.attribute`,
    `breach.waive`, `staff.create`, `staff.grant`, `staff.deactivate`, `staff.reset_totp`),
    entity, before and after, IP, user agent and request id.
- **Enforcement:** `AuditLogInterceptor` checks that every mutating `/admin/*` handler carries
  `@Audited(action)`.
  - A test fails if any `/admin` POST lacks it.
  - The interceptor supplies the request context (IP, user agent, request id, staff) to the
    service.
- **Append-only:** the table's trigger forbids UPDATE and DELETE. There is no endpoint to edit
  rows; a read-only audit view per booking is part of the booking detail.
- **Staff identity:** services that took a stand-in staff actor now take the real staff id:
  `STAFF_ACTOR` in incidents, `SYSTEM_ACTOR` in the dev QA route.

## D5 — S9 endpoints (contracts in `packages/contracts/src/admin.ts`)
- **Auth:** `POST /admin/auth/login | totp | refresh | logout`, `GET /admin/me`.
- **Booking board:**
  - `GET /admin/bookings` — filters for status, city, IST date range, a search (reference, phone,
    name) and needs-attention; keyset cursor; 50 per page.
  - `GET /admin/bookings/:id` — timeline, payments, assignment and events, QA, SLA clocks,
    breaches and alerts.
- **QA:** `GET /admin/qa` (the queue, oldest due first) and `POST /admin/qa/:bookingId`.
  - Pass or fail; a fail needs a note.
  - Calls `QaService.decide` with the staff actor.
- **Incidents:**
  - `GET /admin/incidents` — reports not yet confirmed.
  - `POST /admin/assignments/:id/confirm-incident` — ACCESS_DENIED or UNSAFE_SITE, with a note.
  - CLIENT_ABSENT is listed for visibility; its outcome is a money decision (S10).
- **Dispatch:** `GET /admin/dispatch` (DISPATCHING bookings, with wave, offers and deadline) and
  `GET /admin/dispatch/:bookingId` (the existing desk view). Manual assignment is S10.
- **Breaches:**
  - `GET /admin/breaches` — open, waived or all.
  - `POST /admin/breaches/:id/attribute` — CLIENT or FORCE_MAJEURE means no remedy and no
    deduction.
  - `POST /admin/breaches/:id/waive`.
  - The remedy amount is never applied here.
- **Alerts:** `GET /admin/alerts` — `ops.alert` and `*.needs_review` domain events, newest first,
  city-filtered. Settling them is S10.
- **Staff:** `GET/POST /admin/staff`, `POST /admin/staff/:id/grants`,
  `POST /admin/staff/:id/grants/:grantId/revoke`, `POST /admin/staff/:id/deactivate`,
  `POST /admin/staff/:id/reset-totp` — all SUPER_ADMIN.
  - A SUPER_ADMIN cannot deactivate themselves or remove their own SUPER_ADMIN grant.
- **Dev routes stay** for the e2e tests and local simulators. The admin panel never calls them.

## D6 — The admin web app
- **Location:** `apps/admin` becomes the staff panel (Next.js 16, App Router).
  - Today's simulators (booking, dispatch, pricing calculator, status and roadmap) move under
    `/dev/*`, rendered only in development.
- **UI kit:** `packages/ui-web` = shadcn/ui on Tailwind 4 + Radix, themed from
  `@clickco/design-tokens`.
  - Light theme (`colorLight`): one look across Clickco's surfaces; ADR-0017's dark console was
    an interim tool.
  - Tables use `@tanstack/react-table`, data uses `@tanstack/react-query`, notices use `sonner`.
  - Admin screens compose ui-web only.
- **Security:**
  - Tokens are held in `sessionStorage` behind a nonce CSP and security headers, as in the
    portal (ADR-0015).
  - A 30-minute idle sign-out.
  - Nothing stored beyond the tab.
- **Screens:**
  - sign-in (password → TOTP or enrolment);
  - Bookings board and booking page;
  - QA queue;
  - Incidents;
  - Dispatch;
  - Breaches;
  - Alerts;
  - Staff (SUPER_ADMIN only);
  - a navigation that shows only what the caller's roles allow.
- **The API decides access.** The UI only hides what the server would refuse anyway.

## D7 — Mobile token storage (security review M1, ADR-0024)
`expo-secure-store` holds a random MMKV encryption key in the Keychain/Keystore, which does not
migrate to other devices (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Both apps then open MMKV encrypted.
- A restored backup holds only ciphertext it cannot read.
- Web (development only) keeps the plain store.
- Existing plain stores are re-keyed once on first launch.
