# ADR-0016 — Sprint 8 design: delivery + SLA machine

**Status:** Accepted 24 Oct 2026 (taken on Darshil's behalf; overridable). D9 remedy amounts are
**provisional pending Darshil** and are never applied automatically.
**Sources:** PLAN.md S8 ("Balance payment, delivery links, all BullMQ SLA clocks,
pause-at-BALANCE_PENDING, breach ladder, RAW/JPEG purge, link revoke"); DOMAIN §2 (QA onward),
§4 (SLA), Invariants 2, 6, 7, 9, 10; schema §9–§10 (`deliveries`, `delivery_links`, `sla_clocks`,
`sla_breaches`); T&C §2.3, §5, §6.4, §8.3; ADR-0011, ADR-0013 D7/D10/D12, ADR-0014 "Deferred" and
"Carried forward", ADR-0015 M2.

**Not in S8** (PLAN puts these in S9–10, the finance and ops desks):
- refunds and credits: settlement of the `REFUND_DUE_*`, `*_CREDIT_25`, `*_CHARGE_50`,
  `CLIENT_NON_ATTENDANCE` and capture-anomaly reviews;
- payouts and TDS;
- the staff QA desk UI;
- quality escalations.

S8 records everything those desks need.

## D1 — QA pass and fail
- **Actor.** QA is a STAFF action. Until the S9 desk exists it is done through a development-only
  console route, with SYSTEM as the actor.
- **Pass.**
  - Writes the `deliveries` row: per-kind file counts and bytes of unpurged, verified assets;
    `qa_status` PASSED; `qa_at`.
  - Moves the booking QA → BALANCE_PENDING.
- **Fail.**
  - Records `qa_status` FAILED with a note and raises a HIGH ops alert. The booking stays in QA.
  - A later pass is allowed (after ops fixes the files). There is no new transition: true losses go
    QA → DATA_LOSS (DOMAIN §2, staff).

## D2 — Zero balance goes straight through
A booking with nothing left to pay — emergency bands paid in full with no extensions or waiting —
walks QA → BALANCE_PENDING → DELIVERED with no wait.
- Both are existing DOMAIN edges, so no new transition is added.
- BALANCE_PENDING lasts as long as link creation takes. The pause on the delivery clock is that
  short.
- This resolves "no QA → DELIVERED path for prepaid bookings" (SA-17).

## D3 — Balance: a due notice at QA, the tax invoice on payment
- **At QA pass** the client is shown what is due: `balance_paise`, which already includes every
  approved extension and waiting charge (ADR-0013 D8/D9).
- **The GST tax invoice for the balance is issued when the balance is captured.** It is computed as
  the exact remainder: the totals of every price snapshot minus everything already invoiced, so the
  invoices always sum to the booking's snapshots to the paisa.
- **Ledger:** GST_ACCRUED at invoice issue, plus BALANCE_CAPTURED (+ GATEWAY_FEE).
- **Why not invoice at QA** (DOMAIN §2 says "balance invoice sent")?
  - Invoices are immutable (schema §11), and an unpaid booking is abandoned after 30 days.
  - An invoice raised at QA would put GST on money never received, and would need a credit note,
    which has no table.
  - Invoicing at receipt matches how the advance is invoiced.
- **Doc 05 §8** ("invoiced after check-out") is satisfied: capture is after check-out.
- Recorded as SA-15. A CA should confirm the GST time of supply before launch.

## D4 — Paying the balance
- `POST /bookings/:id/pay` also serves BALANCE_PENDING. It opens (or returns the open) gateway order
  with purpose `BALANCE` for `balance_paise`.
- The verified webhook records the capture and the invoice (D3) in one transaction, and emits
  `payment.balance_captured`.
- A failed payment leaves the booking in BALANCE_PENDING. The client can try again.
- Every money endpoint is idempotent, as before.

## D5 — Release (BALANCE_PENDING → DELIVERED)
- **Trigger.** Driven by the outbox, so it survives a crash: `booking.balance_pending` when nothing
  is due (D2), or `payment.balance_captured`.
- **Step one.** The release subscriber creates a StoragePort delivery link per kind present: JPEG
  always, RAW and VIDEO when uploaded. Link creation is idempotent: an existing `delivery_links` row
  per kind is reused.
- **Step two,** in one transaction:
  - the link rows with a 32-byte random `public_token` (base64url);
  - `deliveries.released_at`, `raw_expires_at` = +7 d, `jpeg_expires_at` = +30 d;
  - `media_assets.purge_after`: RAW +7 d, JPEG/VIDEO +30 d (Invariant 7: measured from delivery);
  - the transition, with payload `delivery_id, raw_expires_at, jpeg_expires_at, link_ids`.
- **Link expiry.** The RAW link expires at RAW purge (+7 d), not at +30 d. A link to deleted files
  would only fail; the schema's single LINK_REVOKE (+30 d) then revokes what is left (SA-18).
- **Public access.**
  - `GET /d/:token` counts the access and redirects (302) to the provider link while it is valid.
  - Expired or revoked links answer 410 `LINK_EXPIRED`.
  - The provider link is never in a JSON response.
  - In development and test, the local adapter's `local://` link cannot be followed. The route
    answers 200 with the kind, expiry and file count instead.
- **Recipient.** `bookings.gallery_recipient` is read by the S11 notifier from the
  `booking.delivered` event.

## D6 — SLA clocks
- **Arming.** On `booking.checked_out` (T0 = `sla_t0`), production clocks are armed: one
  `sla_clocks` row each, plus a delayed BullMQ job `sla.clock-due` (id `sla-{clockId}`). A
  repeatable `sla.sweep` re-fires overdue armed clocks whose job was lost.
- **Offsets.**

  | Clock | Standard | RUSH_24H |
  |---|---|---|
  | UPLOAD_START | +2 h | +1 h |
  | UPLOAD_COMPLETE | +12 h | +6 h |
  | PROCESSING_COMPLETE | +18 h | +9 h |
  | QA_COMPLETE | +24 h | +12 h |
  | DELIVERY_RED_ALERT | +44 h | +20 h |
  | DELIVERY_DUE | +48 h | +24 h |

  Rush halves the ladder; its red alert is 4 h before due, like the standard one.
- **Met by status:**
  - UPLOAD_START at UPLOADING;
  - UPLOAD_COMPLETE at PROCESSING;
  - PROCESSING_COMPLETE at QA;
  - QA_COMPLETE at BALANCE_PENDING;
  - DELIVERY_RED_ALERT and DELIVERY_DUE are paused at BALANCE_PENDING and met at DELIVERED.
- **An unmet internal clock firing** (the first four, and the red alert) marks the clock BREACHED
  and raises an ops alert: MEDIUM for upload start, HIGH for the others and for the red alert. No
  `sla_breaches` row: only the published promise has a client remedy.
- **Terminal statuses cancel every armed clock:** DATA_LOSS, ABANDONED, CANCELLED_*.

## D7 — The pause
- **At BALANCE_PENDING:** `paused_at` is set on DELIVERY_DUE and DELIVERY_RED_ALERT if still armed.
  A due job that fires while paused does nothing.
- **At DELIVERED:** `paused_ms` += delivered − `paused_at`; the clock is MET.
- **Effective due** = `due_at` + `paused_ms`. So the promise is kept exactly when QA passed by the
  due time. This is T&C §5.1's "whichever is later" (SA-07).
- `bookings.delivery_due_at` stays the published nominal due. `sla_clocks` is the truth for breach
  decisions.

## D8 — Balance reminders and abandonment
- **Reminders.** One BALANCE_REMINDER row (the schema allows one per kind), re-armed through three
  due times from BALANCE_PENDING entry: +24 h, +72 h, +7 d. Each fire emits
  `booking.balance_reminder {sequence}`, which S11 notifies. MET at DELIVERED (SA-19).
- **Abandonment.**
  - BOOKING_ABANDON is armed at BALANCE_PENDING entry + 30 d. That is always after the shoot, so it
    is never earlier than T&C §2.3's "30 days after the shoot".
  - If the booking is still BALANCE_PENDING when it fires: → ABANDONED, every media object
    permanently deleted (Invariant 6), remaining clocks cancelled.
  - The advance is kept (T&C §2.3).

## D9 — The breach ladder: recorded, priced provisionally, never auto-applied
- **When DELIVERY_DUE fires unmet** (not paused, not delivered): state BREACHED, a CRITICAL ops
  alert, and `sla.breached`.
- **The `sla_breaches` row is written once the delay is final**, at BALANCE_PENDING entry (the
  effective delivery):
  - `delay_minutes`;
  - band: H0_6 (< 6 h), H6_24, H24_72, H72_PLUS;
  - `attributed_to`: PHOTOGRAPHER when UPLOAD_COMPLETE was breached, else CLICKCO. Staff may
    re-attribute to CLIENT or FORCE_MAJEURE (T&C §5.3) in S9.
  - the provisional remedy below, with `applied_at` NULL;
  - `booking.needs_review` `SLA_BREACH_REMEDY`.
- **Provisional remedy table.** Lives in `SLA_CONFIG`. Darshil to confirm; the T&C states no amounts.

  | Band | Client remedy | Amount | Payout deduction |
  |---|---|---|---|
  | H0_6 | CREDIT | 10 % of total | 10 % |
  | H6_24 | CREDIT | 25 % of total | 25 % |
  | H24_72 | PARTIAL_REFUND | 25 % of total | 50 % |
  | H72_PLUS | PARTIAL_REFUND | 50 % of total | 75 % |

  - Capped at the amount paid (T&C §10.1).
  - CREDIT goes to `client_credits`; refunds go to the S9 refund flow.

## D10 — Retention, revocation, close
At DELIVERED, three more clocks are armed:
- **RAW_PURGE** (+7 d): permanently delete RAW objects, set `purged_at`, revoke the RAW link.
- **JPEG_PURGE** (+30 d): the same for JPEG and VIDEO.
- **LINK_REVOKE** (+30 d): revoke any link still live, then DELIVERED → CLOSED (SYSTEM).

While the booking is in QUALITY_ESCALATION, JPEG_PURGE and LINK_REVOKE re-arm +7 d: the files may
be needed to settle it.

## D11 — Unsafe site: UNSAFE_SITE → UPLOADING (DOMAIN amendment)
- **The new transition.** A staff-confirmed unsafe site keeps what was shot.
  - T0 = the confirmation time. `sla_t0` and `delivery_due_at` are set then, and the production
    clocks are armed on `booking.unsafe_site`.
  - The photographer then uploads: UNSAFE_SITE is an uploadable status, and the first session walks
    UNSAFE_SITE → UPLOADING.
- **Billing follows T&C §8.3** (the contract): full amount, no refund for the uncompleted portion.
  DOMAIN's "partial charge" wording is superseded (SA-16). The `UNSAFE_SITE_PARTIAL_CHARGE` review
  stays, so ops can make a goodwill exception.

## D12 — Client non-attendance
- A client-absent check-out (T&C §3.8, frames 0) arms **no** production clocks: nothing will be
  uploaded, so they would only breach.
- The booking waits in CHECKED_OUT for the existing `CLIENT_NON_ATTENDANCE` review. The S9 desk
  takes it to its outcome (DOMAIN gap recorded as SA-20).
- A waiting charge logged before the absence report is waived at that review: T&C §3.8 already
  charges the full booking for the same absence. This decides ADR-0014's carried-forward
  "stacking" question.
