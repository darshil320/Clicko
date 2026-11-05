# ADR-0030 — Client account deletion, and the staff route to DATA_LOSS

**Status:** Accepted 4 Nov 2026. Taken on Darshil's behalf and overridable: say which decision
to change.
**Sources:** Apple App Store guideline 5.1.1(v); DPDP Act 2023 s.12; CGST Act s.36 (72 months);
`docs/store/README.md` B1; ADR-0029 follow-ups 2 and 3; DOMAIN §2/§3/§5; T&C §5.5; v0.2 G-13;
ADR-0016 D1; ADR-0027 D5a; HANDOVER §3–4.
**Split:** another agent owns client cancellation, the refund ladder and addendum 0019. This ADR
owns addendum **0020** and touches no refund rule; refunds are asked for through the existing
`RefundsService.requestIn`.

## D1 — Account deletion (client app)
- **Endpoints** (`modules/account-deletion`, contracts `account-deletion.ts`, api-client
  `account.*`):
  - `GET /me/deletion` — what is erased, what is kept, the unused credit that is lost, and any
    blockers. No side effects.
  - `POST /me/deletion/request` — sends a 6-digit code (OTP purpose `ACCOUNT_DELETE`) to the
    account's own phone, on its **own DLT template** (`MSG91_DELETE_OTP_FLOW_ID` and
    `MSG91_DELETE_OTP_DLT_TEMPLATE_ID`, required with `SMS_ADAPTER=dlt`), so it never reads as a
    sign-in code. **Owner action:** register that second DLT template (e.g. "##otp## is your
    Clickco code to DELETE your account. Do not share it.") and its MSG91 flow. Refused (409 `ACCOUNT_DELETION_BLOCKED`, one plain sentence per
    booking) while deletion is not possible; nothing is sent then.
  - `POST /me/deletion/confirm` `{ challengeId, code }` — Idempotency-Key required. A wrong
    code is 422 `OTP_INVALID` (not 401: the app would refresh and retry). Guarded by AuthGuard,
    not UserGuard, so a retry after a lost answer reaches the replay; an already-deleted account
    answers with its deletion time whatever the code. The code is checked, and used up, only
    after the blockers are re-checked under the locks, so a refusal leaves it usable.
- **Refused while** a booking is paid and not finished (CONFIRMED … BALANCE_PENDING,
  UNSAFE_SITE), delivered and not closed (DELIVERED, QUALITY_ESCALATION: the photos can still be
  downloaded), waiting for payment (ADVANCE_PENDING), a refund on any of the client's bookings
  is REQUESTED, APPROVED, PROCESSING or FAILED, or an open review item on "To settle" sits on one
  of them (REFUND_DUE_*, the no-show credit, the access-denied remainder, a partial-loss
  remainder: money that may still be owed either way). DRAFT and QUOTED
  never block: the deletion cancels them (`CANCELLED_CLIENT`, payload `reason: ACCOUNT_DELETED`,
  actor USER), so a payment already on its way cannot start.
- **Erased, in one transaction, each by the module that owns the table:**
  - `users`: phone, name, email, default city, marketing and promo consents, block reason →
    NULL/false; `deleted_at` set.
  - `bookings` (every one of the client's): booker name → "Deleted account", booker phone → '',
    subject name/phone, landmark, venue point, special requirements → NULL, venue address → a
    fixed "Erased" line, gallery recipient → BOOKER. Pincode, schedule and prices stay.
  - `reviews`: the client's comments → NULL (rating and sub-scores stay, so the photographer's
    rating does not move); reviews about the client are removed. `reviews` has no author column;
    the review's booking now points at the anonymous account.
  - `moderation_reports`: the note on reports the client filed, and the copy of their review's
    words a report on it kept (`reported_comment`), → NULL. The reports stay (trust and safety).
  - `payments.vpa_or_last4`: a UPI id keeps only its handle (`•••@ybl`); payments stay.
  - `idempotency_keys`: the stored answers of the client's completed requests (a booking's answer
    holds its venue and phones) are deleted.
  - `otp_challenges` for the number deleted; the client's `refresh_tokens` lose their device id
    and user agent.
  - `device_push_tokens`, `notification_preferences`, `client_photographer_blocks`, and
    `waitlist_entries` with the account's number: deleted.
  - `refresh_tokens`: every one revoked in the same transaction; UserGuard and `/auth/refresh`
    answer 401 `SESSION_INVALID` for a deleted account, so a live access token dies at once.
  - Outbox: `user.deleted` (aggregate `user`), counts only, never a name, number or address.
- **Kept:** invoices, payments, refunds, credit notes and ledger entries (GST, CGST Act s.36:
  72 months from the annual return's due date, "8 years" in the copy), still referencing the
  same `users.id` and booking; `booking_status_events`, `audit_logs`, `domain_events`
  (append-only); support tickets with their contact fields and messages (grievance evidence;
  `ticket_messages` is append-only), quality complaints (`quality_escalations.complaint`) and
  equipment claims (`equipment_claims.description`) — all said in the app's "kept" list;
  moderation reports and actions without the client's words; `notification_sends` (masked
  destinations); `call_bindings`/`call_logs` (no numbers). Unused credit is forfeited and shown
  in the preview.
- **Re-registration:** the same number later signs up as a new, empty account (`isNew: true`).
  The old row keeps no phone. One keyed link stays on purpose: each booking records
  `client_phone_key`, HMAC-SHA256(OTP_HASH_PEPPER, "promo-phone:" + phone), never the number, and
  promo eligibility (first booking, per-person cap) counts by it as well as by account, so
  deleting and signing up again does not reuse a first-booking or per-person promo.
- **Addendum/migration 0020:** `users.deleted_at`; `phone_e164` nullable, NULL exactly when
  deleted; `bookings.client_phone_key` (format CHECK, partial index); a CHECK that a deleted row
  is anonymous; a trigger that refuses any change to a
  deleted row; a trigger that refuses a new booking, push token, preference or block for a
  deleted account (it takes `FOR KEY SHARE`, so it waits for a deletion in flight).
- **Lock order:** the client's bookings, then the account, then the bookings again (a payment
  in flight holds its booking and then takes the account's key lock).
- **Blocked clients** cannot reach the routes (UserGuard); they use the grievance route.
- **Mobile screen (not built here):** Profile → "Delete account" in the client app: the
  preview, then "Send code", then the code entry and a final confirm. On success the app clears
  its stored session.

## D2 — The staff routes to a lost shoot (revised 5 Nov after the domain review)
- **Rule (DOMAIN §2, ADR-0016 D1):** STAFF confirms, from UPLOADING, PROCESSING or QA.
  T&C §5.5: complete loss → full refund of all amounts paid; partial loss → pro-rata refund.
  G-13 / ADR-0027 D5a: full photographer payout, the third loss in 365 days withheld.
- **Who:** QUALITY_MANAGER or CITY_MANAGER (+ SUPER_ADMIN), `@CityScoped('booking')`,
  `@Audited`, idempotent. **Four-eyes in the request**, reusing the large-credit pattern
  (ADR-0027 D6a L8, `MoneyStepUp`): the confirmer's fresh authenticator code plus a second
  QUALITY_MANAGER, FINANCE or SUPER_ADMIN covering the city, by sign-in email and their own code.
  Rule refunds skip the refund desk's ceiling, so the confirmation carries it: when what goes back
  (plus refunds and credits already committed) is above the Quality Manager's ceiling
  (`qmCeilingPaise`: the lower of ₹5,000 or half the booking), the second person must be FINANCE
  or SUPER_ADMIN, on both routes; the service checks it under the booking lock.
  The second person is never the confirmer (a super admin cannot co-approve themselves). The
  audit row names both (`co_approved_by`). Missing codes are 400; a wrong one is 422; an invalid
  co-approver is 403 `CO_APPROVER_INVALID`.
- **Complete loss** — `POST /admin/bookings/:bookingId/data-loss` `{ note, code, coApprover }`,
  one transaction (`delivery/DataLossService.confirmComplete`):
  - refunds on the booking still REQUESTED or left FAILED are closed as REJECTED, "Superseded by
    data loss", with `refund.rejected` (`RefundsService.supersedeOpenIn`); a refund raised by
    settling a review item (an SLA-breach remedy) is left alone and stays in flight, so the
    amount below excludes it and the breach is still applied when it completes;
  - an open partial-loss remainder item on "To settle" is closed with no action (the complete
    refund covers it);
  - booking → DATA_LOSS (actor STAFF), `booking.data_loss` (`loss_kind: COMPLETE`,
    `affected_proportion_bps: 10000`, `refund_amount_paise`);
  - the refund is **decided by rule** (`RefundsService.issueByRuleIn`, reason DATA_LOSS, rule
    "T&C §5.5", requested by SYSTEM, no separate approval; four-eyes moved onto the confirmation).
    Amount = per payment, captured − refunded − (APPROVED + PROCESSING); a request still waiting
    no longer reduces it. Sent to the gateway after commit (`sendIssued`).
  - Subscribers: payouts accrue the full payout (or hold the third), SLA cancels every armed
    clock. `SlaService.fire` now also cancels, never breaches, a clock that fires on a booking
    that ended without delivery before its outbox event ran.
- **Partial loss** — `POST /admin/bookings/:bookingId/partial-loss`
  `{ affectedProportionBps (1–9,999), note, code, coApprover }`, once per booking
  (`DataLossService.confirmPartial`): **no transition**; the booking stays on the delivery path.
  - Owed = roundHalfUp(sum of every snapshot total × bps / 10,000), once, in bigint.
  - Refunded now, by rule: as much of it as is refundable today.
  - The rest becomes a `booking.needs_review` item, reason `PARTIAL_DATA_LOSS_REMAINDER`, on the
    "To settle" desk. It suggests the refund once the balance is paid, and "wait" before.
  - `booking.partial_data_loss` (`loss_kind: PARTIAL`, `affected_proportion_bps`,
    `refund_amount_paise` (owed), `refunded_now_paise`, `due_after_balance_paise`). A second
    partial loss is 409 `PARTIAL_LOSS_ALREADY_RECORDED`; a later complete loss is still possible.
  - The photographer is paid in full on delivery (DELIVERED basis); no payout on the event.
- **DOMAIN.md** §2/§3 re-synthesised: DATA_LOSS is the complete loss; `PARTIAL` on
  `booking.data_loss` is reserved.
- **Panel:** "Files lost before delivery" on the booking page, only at those stages and to those
  roles. The SideSheet offers "All of it" or "Part of the shoot" (a percentage), the note and the
  two codes. The confirm dialog says what happens in plain words, with the amounts (now and after
  the balance) and the names. An unknown outcome is retried with the same request.

## Follow-ups
- Photographer deletion: the spec only has staff offboarding (`photographers.offboarded_at`,
  `photographer_documents.purge_after`); payouts, TDS (s.194C) and vendor invoices complicate an
  erasure. A "Request account deletion" row in Pro opens a ticket for now (store README B1).
- The `https://clickco.in/delete-account/` web page Play needs (store README B1).
- A retention sweep for `otp_challenges` (phone + IP), expired `refresh_tokens` and
  `idempotency_keys` in general; none exists (a deleted account's are removed at deletion).
- **Owner question (legal retention period):** how long are closed support tickets (contact
  fields, `ticket_messages`), quality complaints and equipment claims kept? With a period, a
  sweep can erase them; until then they are kept and the app says so.
- Masking the full UPI id on every payment, not only a deleted client's (store README B9).
- Purging media left on a DATA_LOSS booking: its clocks are cancelled, so nothing purges it. A
  media purge job is needed.
- A client notification for `booking.data_loss` and `booking.partial_data_loss`.
- **Owner question:** does a loss on Clickco's own storage (not the photographer's cards) count
  toward the photographer's G-13 cap? Today every DATA_LOSS counts.
- `RuleRefund.requestedBy` allows USER or SYSTEM only, so a data-loss refund is recorded as
  SYSTEM. The audit row and the status event name the staff. Allow STAFF there if refunds should
  name them too.
- A ledger posting for forfeited (and expired) client credit.
- A retention window for closed support tickets and moderation reports, then erase their contact
  fields.
