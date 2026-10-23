# ADR-0012 — Sprint 5 review decisions (dispatch, holds, OTP, outbox)

**Status:** Accepted 23 Oct 2026 (product calls delegated by Darshil to the orchestrator; overridable)
**Sources:** domain-guardian and security-reviewer reports on the Sprint 5 build; ADR-0010, ADR-0011;
v0.2 §8/§9; T&C §3.7 (SPEC-AUDIT SA-14). Amends ADR-0010 (see its addendum) and DOMAIN.md §2.

## D1 — Every unfilled booking is auto-cancelled before the shoot
A booking still `DISPATCHING` at `scheduled_start − auto_refund_minutes_before` → `CANCELLED_PRO`
(reason `UNFILLED`), whatever its band. The minutes come from the booking's **own** ruleset
(`emergency_multipliers`, via `PricingService.autoRefundMinutesBefore`), fallback 90 when null.
Launch ruleset 2026.10.01: 90 for **every** band; `HOURS_3_8.is_guaranteed = false` (T&C §3.7: under
8 h is best effort). Money: an authorisation hold is released; captured money is flagged
`payment.needs_review` `REFUND_DUE_UNFILLED` (the refund flow is S8). Mechanism: a `dispatch.deadline`
BullMQ job per run, plus the 30 s sweeper as backup (any DISPATCHING booking past its deadline is
cancelled even if its job was lost). A job that fires early re-arms under a unique job id.
- *Interpretation:* the deadline always governs the first search; it governs a replacement search
  only if that run started before the deadline — a no-show re-broadcast (which starts after the
  start time) or a very late cancellation runs its waves and ends by exhaustion (D6).
- *Dev databases* seeded before this ADR hold the old emergency rows. Rulesets are never edited where
  it matters (Invariant 17; production has no rows yet), so `pnpm db:seed:dev` (development only)
  realigns the 2026.10.01 emergency rows idempotently (`alignLaunchEmergencyRules`). No migration.

## D2 — Quotes need time to fill
The pricing engine rejects a lead time shorter than `auto_refund_minutes_before + 30 min` with
`LEAD_TIME_TOO_SHORT` (after `START_IN_PAST`, before pricing). At launch the shortest bookable lead
is 2 h. Engine tests that quoted 1 h ahead now quote 2.5 h ahead (same band, same factors).

## D3 — A declined capture cancels directly
A **definitively** declined capture on acceptance: assignment `RELEASED` (`CAPTURE_FAILED`), booking
`ASSIGNED / EN_ROUTE → CANCELLED_CLIENT` (reason `CAPTURE_FAILED`, actor SYSTEM; already legal as a
pre-shoot cancel), hold released by the payments subscriber on `booking.cancelled_client`. No
`booking.redispatching` hop. If the booking is already past EN_ROUTE, the capture is flagged
(`CAPTURE_DECLINED_AFTER_START`) instead.

## D4 — Capture and release outcomes are typed and serialised
`PaymentGatewayPort.capture → CAPTURED | DECLINED | UNKNOWN` and `releaseAuthorization → RELEASED |
CAPTURED | UNKNOWN`; adapters never throw. After **any** capture error the adapter re-reads
`GET /payments/:id`: captured ⇒ CAPTURED; refunded/failed (authorisation gone) ⇒ DECLINED; anything
else (still authorised, 5xx, timeout, unreadable) ⇒ UNKNOWN. Only DECLINED cancels; UNKNOWN throws
`CaptureUnknownError` so the outbox delivery retries (with D9 backoff, then dead-letters to ops).
Release first confirms at the gateway that the payment is not captured; a capture there is flagged
(`CAPTURED_AT_RELEASE`), never refunded blindly. A captured webhook on an `AUTH_RELEASED` payment
books the money (no invoice) and flags `CAPTURED_AFTER_RELEASE`. Capture and release of one payment
are serialised by a Redis lease `payment:{id}` (PX 30 s) held across the gateway call
(`AuthHoldsService`), and the DB status is re-checked afterwards; a mismatch is flagged. Lock order is
**booking → payment** everywhere (the webhook path now finds the payment unlocked, locks the booking,
then locks the payment).

## D5 — No-show incentive on the base service only
A no-show re-broadcast offers `roundHalfUp(baseShare × 20000, 10000) + addonShare + travel`, where
`baseShare = roundHalfUp(base × payout_share)` and `addonShare` is the remainder of the snapshot's
expected payout (so the split reproduces the snapshot exactly). Pure function
`pricing/engine/payout.ts`; dispatch calls `PricingService.noShowPayoutPaise` and never computes money.

## D6 — A failed replacement ends the booking
When a non-initial run exhausts — or its deadline governs and hits — the booking ends in the same
transaction: after a cancellation ⇒ `CANCELLED_PRO` (`REDISPATCH_UNFILLED`); after a no-show ⇒
`PRO_NO_SHOW` (`NO_SHOW_UNFILLED`). Money follows the D1 rules (`REFUND_DUE_UNFILLED` /
`REFUND_DUE_NO_SHOW`). An exhausted first search still waits for the ops desk until its deadline.
`OpsAlertsSubscriber` logs and records an `ops.alert` event (once per source event) for
`dispatch.exhausted`, `ops.dead_letter` and `payment.needs_review`; notifications are S11.

## D7 — Penalties are recorded with the re-dispatch
In the re-dispatch transaction, via `PhotographersService.recordPenalty`: a cancellation after
acceptance ⇒ `photographer_penalties` kind `CONDUCT`, severity 1, note `late cancellation: …`; a
no-show ⇒ kind `NO_SHOW`, severity by un-waived occurrence (1 warning, 2 with 7 deactivation days,
3 removal). Applying deactivations and waivers is ops work (S6/S9).

## D8 — OTP SMS go through a job
Both purposes (`LOGIN`, `PRO_LOGIN`) queue an `auth.otp-sms` BullMQ job (5 tries, 2 s exponential)
and answer 200 at once; a gateway failure is logged and retried, never surfaced. Job data is sealed
(AES-256-GCM, key derived from `OTP_HASH_PEPPER`, challenge id as AAD): Redis never holds a readable
code or phone. A `PRO_LOGIN` for a number that is not an ACTIVE photographer queues an identical
decoy job that sends nothing. 503 `SMS_UNAVAILABLE` now means only "the queue (Redis) is down".
Per-phone limits are per purpose; the IP limit stays global.

## D9 — Outbox backoff and dead letters
Addendum 0004 (`domain_events.next_attempt_at` + partial index). A failed delivery is retried after
2 s, 4 s, 8 s … capped at 15 min; after 50 attempts the event is dead-lettered with an
`ops.dead_letter` event (and an error log). `last_error` stores only `<subscriber>: <ErrorClass>`.

## Also decided in the fix pass
- **Capture is due** whenever a non-released assignment exists and the booking is not cancelled
  (`ACCEPTED_STATUSES` in `bookings/state-machine.ts`, shared with the webhook path).
- **Accept** re-checks inside its transaction that the photographer is still ACTIVE (403
  `ACCOUNT_INACTIVE`) and has no overlapping personal block (409 `SLOT_CONFLICT`); the offer is
  checked (pending, unexpired) before the Redis lock; a held lock is 409 `ACCEPT_IN_PROGRESS`.
- **Accept response is IDs only** (`AcceptOfferResponse {attemptId, assignmentId, bookingId,
  status}`): an idempotent replay can never re-reveal an address after the assignment ends.
  Details come from `GET /pro/assignments`, which lists only active assignments. Idempotency keys on
  `/pro/*` live 10 min; every key is scoped `<subject kind>:<subject id>:<header>`.
- **Photographer-visible text** (address, landmark, special requirements) has 10+-digit runs masked
  `[number hidden]` (Invariant 11); offer distance is rounded to 0.5 km.
- **ProGuard** checks the photographer is still ACTIVE on every `/pro/*` call.
- **Dev-only routes** (`/dev/otp`, `/dev/payments`, `/dev/dispatch`) live in `DevToolsModule`,
  mounted only when `NODE_ENV=development`; elsewhere they do not exist (404).
- **Env:** staging/production require `rediss://` and an explicit `QUEUE_PREFIX`;
  `QUEUE_WORKERS=off` is allowed only in test (tests stub the worker provider instead).
- **Refresh tokens:** rotation grace restored at the DB layer (revoked within 30 s ⇒ GRACE, no mass
  revoke) and the device id carries over; `expectedKind` is required (a token sent to the other
  route is not consumed). Proven by `refresh-token.repository.integration.test.ts`.
- **Dev seed** refuses a non-localhost `DATABASE_URL`; demo phones are `+91 99990 00xxx`. No Indian
  mobile block is guaranteed unallocated, so these may belong to real people — harmless while the
  console SMS adapter only logs; never point the dev seed at a database with a real SMS adapter.
- **Catalogue reads (exception to "never query another module's tables"):** bookings reads
  `categories` / `addons` read-only (codes, `cert_required_from`, `requires_drone_credentials`) as
  `booking-reads.repository` has since Sprint 3. They are seed-owned reference data with no write
  path; a catalogue module takes them over when the admin console edits them (S9).
- **Not changed:** `AUTH_RELEASE_LEAD_MS` (hold expiry on authorisation) is still a 90-min constant
  in checkout; it equals the launch ruleset value. Source it from the ruleset when rulesets diverge.

## Notes for when Razorpay keys exist (sec L14 — no code yet)
- Orders for holds set `payment: { capture: 'manual' }`; Razorpay also accepts
  `payment.capture_options { manual_expiry_period, refund_speed }` — set `manual_expiry_period` so the
  gateway lapses an uncaptured hold no later than our T-90 deadline, as a backstop to our release.
- "Release" is a full-amount `POST /payments/:id/refund` on an authorised payment, which Razorpay
  documents as a void (no MDR) only for the full authorised amount; partial voids are refused. Verify
  the response shape and that `GET /payments/:id` then reports `refunded`, on the test account.
- Capture idempotency relies on `GET /payments/:id` after a 400; confirm the 400 body for "already
  captured" so the adapter could short-circuit without the extra call.

## Schema-guardian follow-ups (addendum 0004)
- **Grants:** when the schema §14 grants migration is written, the `domain_events` column grant must be
  `UPDATE (published_at, publish_attempts, last_error, next_attempt_at)`. Without `next_attempt_at` every failure
  rolls back the publisher tick and the outbox stalls. (0004 itself stays unchanged — it is applied.)
- `appendDomainEventOnce` filters on `aggregate_kind` first so it can use `domain_events_aggregate_idx`.
- Dead letters are parked at `next_attempt_at = 'infinity'`; backoff is measured from the failure time.
- Index builds on hot tables in future addenda should use `CREATE INDEX CONCURRENTLY` in their own migration.
