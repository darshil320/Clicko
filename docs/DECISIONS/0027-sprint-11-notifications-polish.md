# ADR-0027 — Sprint 11: notifications, calls, reviews, and the loose ends

**Status:** Accepted 31 Oct 2026. Taken on Darshil's behalf and overridable. Darshil's instruction
(30 Oct): start Sprint 11, and make the whole app secure, tested and optimised.
**Sources:** PLAN §2 S11 ("WhatsApp templates wired, FCM, Exotel masked calls, reviews, UGC
reporting/blocking, empty/error states, Wave 3 screens — every lifecycle message fires"); the S11
gate (WhatsApp templates approved, DLT headers approved, Exotel KYC done); v0.2 notification
matrix; T&C; ADR-0024/0025/0026 carry-overs.

## D1 — The gate is not met, so everything goes behind ports
No WhatsApp templates, DLT headers or Exotel KYC exist yet. Every channel is a **port** with a
**console adapter** (development and tests: records what would be sent, like the SMS console)
and a **real adapter** chosen by environment:
- WhatsApp Business Cloud API (Meta);
- MSG91 or Gupshup for DLT SMS;
- Firebase Cloud Messaging (Expo push token → FCM/APNs);
- Exotel masked calls.

Production refuses to boot with a console adapter selected. The real adapters are built to each
provider's documented API and tested against recorded fixtures. They go live once credentials and
approvals exist.

## D2 — One notification pipeline
- Domain events (outbox) → a `notifications` module maps each lifecycle event to a template and
  recipients.
- A **per-recipient channel plan** is applied (WhatsApp first, SMS fallback, push for app users)
  with quiet hours: no marketing, 9 pm–8 am IST.
- Sends run through a BullMQ queue with retries.
- Every send is recorded: template, channel, status and provider id.
- Templates are versioned code constants, with variables validated and **no free text from users**.
  Each mirrors what goes to Meta for approval.
- **Lifecycle coverage:**
  - booking confirmed;
  - photographer assigned (name + masked number);
  - on the way;
  - checked in;
  - extension request to the client;
  - checked out;
  - balance due + reminders;
  - delivered with the link;
  - refund issued;
  - credit issued;
  - ticket acknowledged and resolved;
  - Pro: new offer (push), assignment reminder, payout paid.
- Opt-outs: users can mute non-essential channels. Transactional messages always go.

## D3 — Masked calls (Exotel)
Client and photographer talk through a virtual number bound to the booking. The binding opens at
assignment and ends 2 hours after check-out. Neither side ever sees the other's real number. Calls
are logged with duration only, never recordings.

## D4 — Reviews and UGC safety
- **Reviews:** after delivery the client rates 1–5 with an optional comment. One review per
  booking; it can be edited for 7 days. The rating feeds the photographer's metrics.
- **Reporting:** clients and photographers can report a review, a message or a user. Reports go to
  a moderation queue on the admin panel (QM/support): hide, keep, or warn the user.
- **Blocking:** a client can block a photographer from future dispatch to them.
- **Free text:** length limits; links and phone numbers are stripped from public text.

## D5 — Client entry points and polish (carry-overs)
- **In-app:** raise a support ticket (SA-02), report a quality issue on a delivered booking, and
  see refunds and credits on the booking.
- **Admin booking page:** Refund and Issue credit buttons.
- **Payouts** for undelivered shoots: DATA_LOSS, ACCESS_DENIED, CLIENT_ABSENT, under the
  ADR-0013/0016 rules.
- **Pro app:** earnings show paid payouts with TDS.
- **Empty, error and offline states** reviewed on every screen of the client and Pro apps.

## D6 — Security and performance hardening, before any new feature lands
The whole-app audits of 31 Oct (identity and access, money and files, clients, performance) are
fixed first. Every CRITICAL and HIGH finding is fixed with a regression test. MEDIUM findings are
fixed or recorded here with an owner. Recurring checks go into CI:
- `pnpm audit` (fails on high in production dependencies);
- a secret scan;
- the audited-routes and guard-coverage tests.

Recorded (identity and access audit, L4 — owner: API): the global per-IP throttler
(`IpThrottlerGuard`, @nestjs/throttler) keeps its counters in process memory. That is correct for
the single launch instance only; before the API runs as more than one instance, its storage moves
to Redis (a ThrottlerStorage backed by the shared REDIS client), or each instance would allow the
full limit. The OTP limits (Postgres + Redis) and the staff lockouts (Redis) are already shared.

### D6a — Money and files audit (31 Oct 2026): what was done
Each item has a regression test. Migration/addendum **0012** carries the schema side.

- **H1 — untrusted RAW files.** darktable now runs in a separate **media worker** (`src/worker.ts`,
  `pnpm --filter @clickco/api start:worker`) that loads only the media-export processor and its
  module (no payments, dispatch, auth or admin code). With `MEDIA_WORKER_ISOLATED=true` the API
  process neither consumes the `media-export` queue nor registers the processor; staging and
  production refuse `JPEG_EXPORT_ADAPTER=darktable` without it. In code: a RAW above the largest
  accepted photo is refused before download and again before darktable runs; on Linux darktable
  runs under `ulimit -v` (6 GB), refusing to start if the cap cannot be set; it keeps the stripped
  environment, the file-signature check and the 120 s timeout. The container hardening the worker
  needs is in apps/api/CLAUDE.md ("Media worker"); it is a launch-checklist item (S12, replaces
  ADR-0015 "H3 isolation").
- **H2 — payouts could pay twice.** Export, bank file, mark paid, mark failed and send again each
  need a fresh authenticator code. Marking a transfer failed needs the bank's return reference.
  Mark failed and send again are **maker–checker**: never the person who created the bank file the
  transfer went out in (checked before the code is spent, and again in the transaction). A resend
  within 7 days of the original file raises a HIGH `ops.alert` (`payout.early_resend`). Each
  transfer records who made its bank file and when (the first file's time survives resends).
- **Refunds and credits.** Approving a refund that takes the booking above the QM ceiling needs
  the approver's fresh code (the refund item says so: `needsAuthenticatorCode`). **L8:** a credit
  above ₹5,000 (`MONEY_DESK_CONFIG.creditFourEyesPaise`, from `CREDIT_FOUR_EYES_PAISE`) is
  four-eyes in one request: the issuer's code and a second FINANCE/SUPER_ADMIN's sign-in email and
  own code; the audit row names the co-approver. Same rule when settling a review item with a credit.
- **M1.** No grants beyond migration 0011 were needed: 0012 only adds columns, one table
  (`payment_webhook_rejections`, a mutable counter, not append-only) and constraints.
- **M2 — KYC documents.** The API never returns a provider URL. `view-link` returns an opaque,
  single-use path `GET /admin/supply/kyc/view/<token>` (only its sha256 is kept, in Redis, 5
  minutes, bound to the staff member who asked, consumed atomically with GETDEL). The route sits
  behind StaffGuard, streams the bytes from StoragePort with `no-store`, `nosniff` and a sandbox
  CSP, and audits every open (`kyc.document_opened`). The panel fetches the bytes with the staff
  session and opens them from an object URL (only `blob:` of its own origin is followed).
- **M3 — payment webhooks.** The webhook route skips the global per-IP throttle (a gateway retry
  burst must never be dropped); bad signatures are limited per caller IP in Redis (10 per 15
  minutes, IP hashed), after which that IP's unverified requests are 429 before anything is stored.
  Valid signatures are never limited. A bad signature is counted per provider per UTC hour
  (`payment_webhook_rejections`, with a sample body hash), not stored as a row each.
- **M4 — bank account numbers.** Their own `BANK_ACCOUNT_KEY` (32 bytes), required when deployed,
  never equal to STAFF_TOTP_KEY. The sealed value starts with a key-version byte; rotation =
  `BANK_ACCOUNT_KEY_VERSION` up, old key in `BANK_ACCOUNT_KEY_PREVIOUS` (opens only) until a re-seal.
  The STAFF_TOTP_KEY-derived key (version 1) remains for development data only.
- **M5 — delivery links: stream through Clickco.** Chosen over per-recipient Drive permissions:
  clients do not all have Google accounts, a Drive permission outlives a forwarded link's owner,
  and Drive has no expiring links of its own (ADR-0026). `/d/<token>` never redirects; it lists the
  link's files (`DeliveryFolderView`), and `/d/<token>/files/<id>` streams each file from
  StoragePort as an attachment (`no-store`, `nosniff`, sandbox CSP). **Deferred:** HTTP Range
  (StoragePort.openObject has no ranged read; resumable downloads of large RAW files wait for it),
  and the client-facing page that renders the listing (apps/web or the client app, other streams).
  Bandwidth through the API is the accepted cost; revisit at launch volume.
- **L1.** A verified webhook keeps only the fields Clickco parsed (ids, amount, kind) and the sha256
  of the exact body; payer email, contact and VPA are never stored. Existing payloads are reduced
  to their event type by 0012.
- **L2.** Delivery-link tokens are derived (HMAC-SHA256 under `DELIVERY_LINK_KEY`, required when
  deployed) and only their sha256 is stored; existing rows were backfilled and their tokens cleared.
- **L3.** A BullMQ repeatable job (`checkout.stale-advance-sweep`, every 5 minutes) cancels
  ADVANCE_PENDING bookings whose payment window closed (quote expiry + 30 min grace, or the start
  passed): ADVANCE_PENDING → CANCELLED_CLIENT by SYSTEM, reason `PAYMENT_WINDOW_EXPIRED`, which
  frees the promo redemption. DOMAIN §2 lists this transition for USER only; this ADR adds the
  SYSTEM actor for an unpaid quote (no money has moved; a late capture takes the existing
  "captured on a cancelled booking" review path).
- **L4.** No public sandbox webhook secret: `SANDBOX_WEBHOOK_SECRET` (32+ characters, never the old
  published string) is required with the sandbox in development; tests get a random one.
- **L5.** The authorise-only hold lease is 90 s (a release makes up to three 10 s gateway calls).
- **L6.** Paying plans the order under the booking lock, creates the gateway order with no
  transaction open, then records it under the lock after re-planning (a concurrent winner's order
  is returned; a changed amount is 409 `BOOKING_CHANGED`).
- **L7.** A UTR identifies one transfer: two exclusion constraints on `payouts` (same UTR ⇒ same
  batch and same photographer) plus the service check.
- **L9.** A refund webhook whose relay fails is marked failed like any other webhook, so the
  gateway's retry processes it again.
