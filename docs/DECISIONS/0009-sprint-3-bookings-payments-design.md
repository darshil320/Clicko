# ADR-0009 — Sprint 3 design: bookings, payments, ledger

**Status:** Accepted 23 Oct 2026 (taken on Darshil's behalf; overridable)
**Sources:** DOMAIN.md §2–§6, doc 05 §8–§9, schema §7/§11/§13, v0.2 §8, T&C §2.2.

## Module boundaries (no cycles)

| Module | Owns tables | Knows about |
|---|---|---|
| `bookings` | bookings, booking_price_snapshots, booking_addons, booking_status_events | the state machine; writes domain_events in the same transaction as every transition |
| `payments` | payments, payment_webhook_events, invoices, invoice_series, ledger_entries, idempotency_keys | payment gateways, invoices, the ledger. Never reads or writes booking status |
| `checkout` | none | orchestrates pricing → bookings → payments; owns the HTTP endpoints |

`checkout` depends on `pricing`, `bookings`, `payments`. Nothing depends on `checkout`.

## State machine
A pure transition table (`bookings/state-machine.ts`) mirroring DOMAIN.md §2 exactly: `canTransition(from, to)`
and `assertTransition`. `BookingsService.transition(id, to, actor, reason, metadata, tx)`:
`SELECT … FOR UPDATE` → assert legal → `UPDATE bookings` → `INSERT booking_status_events` →
`INSERT domain_events` (event type `booking.<to_lowercase>`), all in one transaction (outbox).
Sprint 3 drives DRAFT → QUOTED → ADVANCE_PENDING → CONFIRMED and CANCELLED_CLIENT; the table holds every
transition so later sprints only add callers.

## Booking creation
`POST /bookings` (auth: USER, idempotent): re-prices server-side with the signed-in user's real promo usage
(never trusts a client total), inserts the booking at QUOTED with snapshot sequence 1 and `quote_expires_at`
(+15 min). Fields: tier, category, pincode, scheduledStart, hours, addons, venue address, booker/subject,
gallery recipient, special requirements, model-release consent (opt-in, never defaulted, Invariant 22).

## Payments
- `PaymentGatewayPort`: `createOrder`, `verifyWebhookSignature`, `capture`, `parseWebhook`.
- `RazorpayGateway`: real HMAC-SHA256 webhook verification (`X-Razorpay-Signature` over the raw body);
  order/capture HTTP calls are implemented but inert until keys exist (PLAN gate S3).
- `SandboxGateway` (development/test only; env refuses it in staging/production, like the console SMS
  adapter): creates fake orders and lets the dev console "pay" by emitting a correctly signed webhook.
- `POST /bookings/:id/pay` (idempotent) → ADVANCE_PENDING + gateway order for `advance_paise`
  (100% for SAME_DAY/HOURS_3_8; authorise-only for HOURS_UNDER_3, doc 05 §8).
- `POST /payments/webhooks/:provider`: verify signature first (invalid → 400, recorded with
  `signature_valid=false`), dedupe on `(provider, provider_event_id)`, then capture → CONFIRMED.
  Replays are no-ops (200).

## Invoices and ledger (doc 05 §9)
- On advance capture: issue a GST invoice for the advance. Taxable and GST are split in proportion to
  the snapshot (`taxable_part = roundHalfUp(advance × taxable / total)`, GST = remainder, CGST/SGST by
  place of supply). The balance invoice (S8) takes exact remainders, so the two always sum to the
  snapshot.
- Invoice numbers come from `allocate_invoice_number('CLK-INV', FY)`; FY series rows are created on demand.
- Ledger postings per capture, each its own balanced txn:
  `ADVANCE_CAPTURED` (Dr CASH_GATEWAY / Cr CLIENT_RECEIVABLE),
  `GST_ACCRUED` at invoice issue (Dr CLIENT_RECEIVABLE / Cr REVENUE_SERVICE + REVENUE_TRAVEL + GST_OUTPUT_PAYABLE),
  `GATEWAY_FEE` when the gateway reports it. The app checks balance before insert; the deferred DB
  trigger is the guarantee.

## Idempotency (G-34)
`@Idempotent()` interceptor on every money-mutating endpoint: `Idempotency-Key` header required (400
without), scoped per subject + route, request body hashed. Same key + same hash → stored response
replayed; same key + different hash → 422; concurrent duplicate → 409.

## Deferred
Outbox publisher (BullMQ) lands in S5 with its first consumer (dispatch). Refunds, the balance payment and
the abandonment clock land in S8. The staff audit interceptor lands with the admin panel (S9).
