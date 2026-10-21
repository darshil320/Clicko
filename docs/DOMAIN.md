# CLICKCO — DOMAIN REFERENCE

**The canonical domain model, synthesised from `docs/clickco-v0.2-locked-spec.md`, `docs/clickco-terms-conditions-v2.md`, `docs/clickco-04-schema.sql`, and `docs/clickco-05-pricing-engine.md`.**

This is the file every future session should read before touching bookings, dispatch, pricing, media, or SLA logic. If this file and one of the source specs ever disagree, the source spec wins for now — but treat that as a bug in this file and fix it, since divergence here is exactly the failure mode this document exists to prevent. See `docs/SPEC-AUDIT.md` for the audit that produced this synthesis and any open inconsistencies.

---

## 1. Entity glossary

| Entity | One-line definition |
|---|---|
| `users` | A client — the person who books and pays. May differ from who is at the venue (see `booker`/`subject`). |
| `staff_users` | An internal Clickco employee with a role-scoped admin login. |
| `cities` | A launched or pending market; carries `area_status` (LIVE/PILOT/WAITLIST/BLOCKED) and a `city_tier` that drives pricing. |
| `serviceable_areas` | A pincode's booking eligibility and travel zone; the gate every booking passes through first. |
| `waitlist_entries` | A demand signal from a non-serviceable pincode; ranked by ops as the expansion roadmap. |
| `categories` | A shoot type (Food, Wedding, Portrait, Product, Event, Real Estate, Corporate) with its own pricing uplift and certification requirement. |
| `plan_deliverables` | What a plan tier promises (frames/hour, gear class, dual-card, RAW/JPEG/video inclusion, delivery hours), versioned per ruleset. |
| `addons` | An optional paid extra (second shooter, drone, lighting kit, rush delivery) with its own eligibility rules. |
| `pricing_rulesets` | A versioned, effective-dated container for every price-related table. A booking snapshots one ruleset and never reprices. |
| `photographers` | A contracted vendor (never an employee) who shoots bookings; owns their own gear; manually verified. |
| `photographer_applications` | The onboarding kanban stage for a prospective photographer. |
| `photographer_documents` | An uploaded, human-reviewed KYC/certification document (never Aadhaar numbers — see Invariant 15). |
| `photographer_contracts` | The signed vendor services agreement — the primary legal defence of contractor (not employee) status. |
| `bookings` | The central aggregate: one shoot engagement, from DRAFT to CLOSED, carrying schedule, venue, pricing totals, and SLA anchors. |
| `booking_price_snapshots` | An immutable, fully itemised price computation frozen at quote time (sequence 1) or at each extension (sequence 2+). |
| `booking_status_events` | The append-only audit trail of every status transition a booking has ever made. |
| `dispatch_rounds` / `dispatch_attempts` | The cascade (or emergency broadcast) that offers a booking to candidate photographers, wave by wave, with accept/decline/expiry tracked per candidate. |
| `assignments` | One photographer's engagement with one booking: acceptance, geofenced check-in/out, and the exclusion-constrained calendar block that prevents double-booking. |
| `assignment_events` | Append-only log of everything that happens during an active assignment: extension requests/approvals, waiting-time logs, notes, safety/access reports. |
| `upload_sessions` | One resumable multipart upload attempt (web portal, 99% of bytes; Pro app, proof shots only) for a booking's media. |
| `media_assets` | One stored file (RAW/JPEG/video/proof), adapter-agnostic, carrying its own retention (`purge_after`) clock. |
| `deliveries` | The QA-gated release record for a booking's finished media: counts, bytes, and the RAW/JPEG expiry timestamps. |
| `delivery_links` | A revocable, expiring, access-counted link handed to the client — never a raw provider link. |
| `sla_clocks` | One timed promise (upload start, delivery due, RAW purge, etc.) anchored to a booking, pausable during non-Clickco-caused delay. |
| `sla_breaches` | A recorded miss of an `sla_clocks` row, with the remedy applied and who it's attributed to. |
| `payments` | One Razorpay transaction (advance/balance/full/extension/edit), including the authorise-then-capture path for sub-3h emergency bookings. |
| `invoices` | A GST-compliant, sequentially numbered, immutable tax invoice issued to the client. |
| `vendor_invoices` | The (often self-billed) invoice from a photographer to Clickco for one booking's payout. |
| `payouts` / `payout_batches` | What a photographer is owed and paid, net of TDS and penalty deductions, batched for processing. |
| `ledger_entries` | The append-only, transaction-balanced double-entry record of every money movement. Balances are always derived, never stored. |
| `refunds` / `client_credits` | Money or credit returned/granted to a client, each carrying a `reason_code`. |
| `quality_escalations` | The Quality Manager queue for client complaints about shoot/output quality; resolves to reshoot/free-edit/partial-credit/no-action. |
| `disputes` | The chargeback/billing/conduct/delivery dispute queue, carrying an evidence pack for resolution. |
| `domain_events` | The transactional outbox: every domain event, written in the same transaction as its state change, published by a poller. |
| `audit_logs` | Append-only record of every staff/admin action (actor, action, entity, before/after state). |
| `idempotency_keys` | The dedupe record for every money-mutating API call. |

---

## 2. Booking state machine — transition table

T0 for all SLA purposes is **`actual_check_out`** (the CHECKED_OUT transition), **never** booking creation. The delivery clock *pauses* (not restarts) while a booking sits in `BALANCE_PENDING`, resuming when the balance clears — this is equivalent to, and implements, T&C §5.1's "whichever is later" framing without a second anchor timestamp.

| From | To | Trigger | Actor | Side effects | Emitted event |
|---|---|---|---|---|---|
| — | DRAFT | Client starts a booking | USER | Draft booking row created | `booking.drafted` |
| DRAFT | QUOTED | Pricing engine resolves a quote | SYSTEM | `booking_price_snapshots` seq 1 written; `quote_expires_at` = now+15min | `booking.quoted` |
| QUOTED | ADVANCE_PENDING | Client proceeds to pay | USER | Razorpay order created | `booking.advance_pending` |
| ADVANCE_PENDING | CONFIRMED | Advance payment captured (or authorised, for <3h emergency) | SYSTEM (webhook) | `payments` row captured/authorized; invoice issued for the advance | `booking.confirmed` |
| CONFIRMED | DISPATCHING | Dispatch cascade begins | SYSTEM | `dispatch_rounds` wave 1 opened (or single broadcast wave for emergency) | `booking.dispatching` |
| DISPATCHING | ASSIGNED | A photographer accepts | PHOTOGRAPHER | `assignments` row created; Redis lock + Postgres exclusion constraint claim the slot; for HOURS_UNDER_3, payment captured now | `booking.assigned` |
| ASSIGNED | EN_ROUTE | Photographer starts travelling (T-60m) | PHOTOGRAPHER | Live location sharing begins | `booking.en_route` |
| EN_ROUTE | CHECKED_IN | Geofenced check-in (≤150m of venue) | PHOTOGRAPHER | `assignments.check_in_at`/location/accuracy written (immutable once set); billing clock starts | `booking.checked_in` |
| CHECKED_IN | IN_PROGRESS | Shoot begins | PHOTOGRAPHER / SYSTEM | — | `booking.in_progress` |
| IN_PROGRESS | EXTENSION_REQUESTED → EXTENSION_APPROVED | Photographer requests +1hr; client approves | PHOTOGRAPHER, then USER | `assignment_events` EXTENSION_REQUESTED/APPROVED; `booking_price_snapshots` seq 2+ written; balance invoice updated | `assignment.extension_requested`, `assignment.extension_approved` |
| IN_PROGRESS | CHECKED_OUT | Geofenced check-out, minimum duration elapsed | PHOTOGRAPHER | `assignments.check_out_at` written (immutable); **`sla_t0` set here**; all `sla_clocks` armed | `booking.checked_out` |
| CHECKED_OUT | UPLOADING | Upload session opens on the web portal | PHOTOGRAPHER | `upload_sessions` row OPEN | `booking.uploading` |
| UPLOADING | PROCESSING | Upload verified complete | SYSTEM | RAW→JPEG batch export worker starts | `booking.processing` |
| PROCESSING | QA | JPEG export complete | SYSTEM | File-count/corruption check queued for ops | `booking.qa` |
| QA | BALANCE_PENDING | QA passes | STAFF or SYSTEM | Balance invoice sent; **delivery clock pauses here**; media withheld | `booking.balance_pending` |
| BALANCE_PENDING | DELIVERED | Balance payment cleared | SYSTEM (webhook) | Delivery links generated and issued (never by the photographer); delivery clock resumes/completes; `deliveries.released_at`, `raw_expires_at`=+7d, `jpeg_expires_at`=+30d set | `booking.delivered` |
| DELIVERED | CLOSED | +30 days elapse | SYSTEM | Auto-close; RAW already purged at +7d if not sooner | `booking.closed` |
| *(any pre-shoot state)* | CANCELLED_CLIENT | Client cancels | USER | Refund per T&C §3.1/§3.2/§3.3 ladder | `booking.cancelled_client` |
| *(any pre-shoot state)* | CANCELLED_PRO | Photographer cancels after acceptance | PHOTOGRAPHER / SYSTEM | Re-dispatch attempted; penalty logged against photographer | `booking.cancelled_pro` |
| ASSIGNED / EN_ROUTE | PRO_NO_SHOW | No CHECKED_IN by scheduled_start+15min, unfilled after escalation | SYSTEM | SMS/call → ops alert (+5min) → emergency broadcast (2.0×) → full refund + ₹500 credit if unfilled; photographer penalty (warning/7-day deactivation/removal by occurrence count) | `booking.pro_no_show` |
| CHECKED_IN / IN_PROGRESS | ACCESS_DENIED | Venue access denied/withdrawn | PHOTOGRAPHER (reports) / STAFF (confirms) | 50% of booking value charged; booking treated as completed | `booking.access_denied` |
| IN_PROGRESS | UNSAFE_SITE | Photographer reasonably believes the environment is unsafe | PHOTOGRAPHER (notifies ops first) | Ops-approved abort; partial charge; files captured so far delivered on full payment | `booking.unsafe_site` |
| UPLOADING / PROCESSING / QA | DATA_LOSS | Verified complete or partial loss of shoot data before delivery | STAFF (confirms) | Complete loss → full client refund + full photographer payout (capped at 2 incidents/photographer/year); partial loss → pro-rata client refund | `booking.data_loss` |
| DELIVERED (or earlier) | QUALITY_ESCALATION | Client flags a quality issue | USER | Routed to `quality_escalations` / Quality Manager queue; photographer paid in full regardless; 3 escalations → tier review | `booking.quality_escalation` |
| BALANCE_PENDING | ABANDONED | Balance unpaid for 30 days | SYSTEM | Booking closed; all media permanently purged; no refund of advance | `booking.abandoned` |

---

## 3. Domain event catalogue

Every state transition above emits its event in the same transaction as the state change, via the `domain_events` transactional outbox (published by a poller — never a direct, synchronous side-effecting call). Payload shape is the same envelope for all event types:

```json
{
  "event_id": "uuid",
  "event_type": "booking.checked_out",
  "aggregate_kind": "booking",
  "aggregate_id": "uuid",
  "payload": { "...": "event-specific fields" },
  "occurred_at": "timestamptz"
}
```

Representative payloads:

| event_type | Key payload fields |
|---|---|
| `booking.quoted` | `snapshot_id`, `total_paise`, `advance_paise`, `ruleset_version`, `quote_expires_at` |
| `booking.confirmed` | `payment_id`, `amount_captured_paise`, `is_auth_only` |
| `booking.assigned` | `photographer_id`, `assignment_id`, `dispatch_round_id`, `rank_score` |
| `booking.checked_in` | `assignment_id`, `check_in_location`, `check_in_accuracy_m`, `check_in_offline` |
| `booking.checked_out` | `assignment_id`, `check_out_location`, `sla_t0`, `declared_frame_count` |
| `assignment.extension_approved` | `assignment_id`, `minutes`, `amount_paise`, `new_snapshot_sequence` |
| `booking.delivered` | `delivery_id`, `raw_expires_at`, `jpeg_expires_at`, `link_ids` |
| `booking.pro_no_show` | `assignment_id`, `escalation_stage`, `refund_amount_paise`, `credit_amount_paise` |
| `booking.data_loss` | `loss_kind` (`COMPLETE`/`PARTIAL`), `affected_proportion_bps`, `refund_amount_paise` |
| `sla.breached` | `clock_id`, `kind`, `delay_minutes`, `band`, `client_remedy_kind`, `client_remedy_paise` |

Three independent subscribers is the expected fan-out pattern (e.g. `booking.checked_out` → SLA clock arming + upload reminder + client notification). Modules never call each other's write paths directly — only through injected services or by subscribing to events.

---

## 4. SLA clock ladder

All offsets are from **`sla_t0` = `actual_check_out`**, except where noted. `paused_ms`/`paused_at` on `sla_clocks` accounts for time spent in `BALANCE_PENDING` — Clickco is never liable for a breach caused by the client not paying.

| `sla_kind` | Anchor | Offset | On-breach behaviour |
|---|---|---|---|
| `UPLOAD_START` | T0 (check-out) | +2h | Internal ops signal; not client-facing |
| `UPLOAD_COMPLETE` | T0 | +12h | Internal ops signal |
| `PROCESSING_COMPLETE` | T0 | +18h | Internal ops signal |
| `QA_COMPLETE` | T0 | +24h | Internal ops signal |
| `DELIVERY_RED_ALERT` | T0 | +44h | Ops dashboard warning, pre-breach |
| `DELIVERY_DUE` | T0 | +48h | **The published promise.** Breach → `sla_breaches` row; remedy banded by delay (`H0_6`/`H6_24`/`H24_72`/`H72_PLUS`) as credit/partial refund/full refund, attributed to PHOTOGRAPHER/CLICKCO/CLIENT/FORCE_MAJEURE |
| `BALANCE_REMINDER` | delivery ready | +24h / +72h / +7d | Escalating reminder notifications; does not pause the clock further |
| `BOOKING_ABANDON` | balance unpaid | +30d | Booking → `ABANDONED`; all media purged; no advance refund |
| `RAW_PURGE` | delivered_at | +7d | Permanent delete (`files.delete`, never trash) — irreversible |
| `JPEG_PURGE` | delivered_at | +30d | Permanent delete — irreversible |
| `LINK_REVOKE` | delivered_at | +30d | `delivery_links.revoked_at` set; link no longer resolves |

Only `DELIVERY_DUE` is published to the client as "the 48-hour promise." Two clocks exist internally (`production_sla` = the clock above; `time_to_payment` = client's own responsiveness) — only the first is ever surfaced.

---

## 5. Money rules — stated as absolutes

1. **Money is always `bigint` paise in the database and integer paise in application code.** ₹8,500.00 is `850000`. No float, `DECIMAL`, `NUMERIC`, or JS `Number` with a fractional component may ever represent a monetary amount.
2. **Percentages and multipliers are integer basis points.** 18% is `1800`. 1.15× is `11500` (10000 = 1.00×).
3. **A `booking_price_snapshots` row is immutable once written** — enforced by a `forbid_update` trigger, not just convention. An extension creates a new `sequence`, never mutates an existing one.
4. **A booking never reprices.** It holds the `ruleset_id` it was quoted against for its entire lifetime, even after that ruleset is superseded.
5. **Rounding happens exactly once per line item, half-up, in integer/BigInt arithmetic**, never on a pre-summed total. Multipliers (uplift × emergency × surge × night × weekend) compose in a single expression before that one rounding step.
6. **Addons and travel are never multiplied by surge or emergency multipliers.** They are flat/metered charges layered on top of the multiplied base.
7. **Extension pricing = base hourly × category uplift only** — no surge, no emergency, no night/weekend multiplier. Waiting-time pricing = 60% of the extension hourly, after a 15-minute grace.
8. **The ledger is append-only and must balance within every `txn_id`** — enforced by a deferred constraint trigger, not application logic alone. Balances are always derived by summing entries, never stored as a running total.
9. **Every money-mutating endpoint requires an idempotency key.** Duplicate requests replay the stored response; they never re-execute the mutation.
10. **GST inclusive-vs-exclusive is a single ruleset-level flag** (`pricing_rulesets.prices_include_gst`) applied uniformly — never mixed within one ruleset. See `docs/OPEN-DECISIONS.md` — this flag's value is not yet chosen.
11. **Advance/balance split is banded by emergency tier**: NONE/NEXT_DAY = 50/50 (balance invoiced after check-out, media withheld until cleared); SAME_DAY/HOURS_3_8 = 100% at booking; HOURS_UNDER_3 = 100% authorised only, captured on photographer acceptance, released in full if unfilled.
12. **The 50/50 split absorbs its odd paise into the advance**: `advance = ceil(total / 2)`, `balance = total - advance`. The two must sum exactly to the total, or the row is rejected by a CHECK constraint.

---

## 6. Invariants

Numbered; each is something that must never happen. A code change that would violate one of these needs a documented, deliberate exception — not a silent workaround.

1. **A booking must never transition to a status not present in the table in §2 of this document**, and every transition must be logged to `booking_status_events`.
2. **`sla_t0` must never be set from anything other than `actual_check_out`.** Never booking creation, never `CONFIRMED`, never `ASSIGNED`.
3. **A `booking_price_snapshots` row must never be UPDATEd.** Corrections are a new sequence, never a mutation.
4. **`ledger_entries` must never be UPDATEd or DELETEd**, and every `txn_id` must sum to zero (debits = credits) before the transaction commits.
5. **`booking_status_events`, `assignment_events`, `photographer_application_events`, and `audit_logs` must never be UPDATEd or DELETEd.**
6. **RAW files must never be trashed instead of permanently deleted.** `files.delete`, never `files.update{trashed:true}` — trash still consumes the storage quota for 30 days.
7. **RAW retention must never be measured from the shoot date.** Always from `delivered_at`. A delayed shoot must never cause its own files to be deleted before the client can download them.
8. **A photographer must never be dispatched to a booking that overlaps their existing `blocked_from`–`blocked_until` window.** Enforced at two layers: a Redis `SETNX` lock at accept time (fast path) and a Postgres `EXCLUDE USING gist` constraint on `assignments` (the guarantee).
9. **A delivery link must never be issued before full payment (advance + balance + any extensions) has cleared.**
10. **A delivery link must never be generated or shared by a photographer directly.** Only Clickco issues links; the Pro app hides client contact details after `CLOSED`.
11. **A photographer's real phone number must never be exposed to a client, or vice versa.** All calling is masked (Exotel virtual numbers).
12. **A module must never write directly into another module's tables.** Cross-module effects happen only via injected services or domain events.
13. **A cross-feature import must never exist in client-side code** (`features/X` must not import from `features/Y`).
14. **Money must never appear as a float, `DECIMAL`, or `NUMERIC` type anywhere in the schema or in `packages/contracts`.**
15. **A photographer's full Aadhaar number must never be stored.** Identity is confirmed at interview and recorded as a boolean plus last-4 of whichever ID was shown — this is a deliberate DPDP-driven restriction, not an oversight.
16. **Photographer bank account numbers must never be stored in plaintext.** `account_number_enc` is encrypted at rest; only `account_last4` is queryable in the clear.
17. **A price ruleset publish must never affect an in-flight booking.** Bookings hold their `ruleset_id` for life.
18. **Only one `pricing_rulesets` row may be open-ended (`effective_to IS NULL`) at any time** — enforced by a partial unique index.
19. **Emergency-band resolution must never be user-selected.** It is always computed from `(scheduled_start - now)` at quote time; the UI reflects the computed band, it does not set it. The <3h boundary is exclusive at the top (exactly 3.0h lead time resolves to `HOURS_3_8`, not `HOURS_UNDER_3`).
20. **Two overlapping festival-calendar surge rows must never stack multiplicatively.** Take the maximum multiplier among overlapping rows, never the product.
21. **A promotional (marketing) use of a client's photos must never occur without `users.promo_use_consent = true`**, recorded with a timestamp — opt-in only, per T&C §9.4, never opt-out.
22. **A model-release / minor-consent checkbox must never be defaulted to checked.** Opt-in, one checkbox, per booking.
23. **A booking must never be created for a `BLOCKED` or `WAITLIST`-status pincode.** WAITLIST captures a `waitlist_entries` row instead and does not create a booking.
24. **A Drive upload must never bypass the rate-limited BullMQ queue.** The Drive SDK must never be called directly from a service — only from `infra/storage/adapters/`.
25. **Storage access must never occur outside `StoragePort`.** No code outside the adapter layer may import a storage provider's SDK directly — this is what keeps the eventual Drive→R2 migration a one-adapter-class change.

---

*This document should be re-synthesised (not hand-patched piecemeal) whenever a locked decision changes in `clickco-v0.2-locked-spec.md`, the T&C, the schema, or the pricing engine spec — otherwise it silently drifts from the source of truth it exists to summarise.*
