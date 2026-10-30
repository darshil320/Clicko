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
