# ADR-0031 — Client cancellation and the T&C §3 refund ladder

**Status:** accepted (S12 launch gap, 5 Nov 2026). Owner-overridable where marked.
**Context:** ADR-0029 found that a paid booking could not be cancelled by anyone, so the T&C v2 §3
ladder was unreachable. DOMAIN §2 allows `any pre-shoot state → CANCELLED_CLIENT` by the client.

## D1 — The ladder, as built (`modules/cancellations`, `cancellations.config.ts`)
- Shares of the **advance**, rounded half-up once in the client's favour. Anything paid beyond the
  advance comes back in full; refund + kept = paid.
- §3.1 standard bookings, by the notice given:
  - 7 days or more: 100 %. 3–7 days: 100 %.
  - 24–72 hours: 50 %. Under 24 hours: nothing.
  - Exact boundaries go to the client: 72 h is "3–7 days", 24 h is "24–72 hours", and exactly
    7 days is not "less than 7 days".
- §3.2 peak season (the quote's `is_peak_season`, recomputed from the booking's own ruleset): under
  7 days the refund is a **flat 50 %**, whatever the notice — under 24 hours included. This reads
  "50 % of the advance is forfeited on any cancellation made less than 7 days before the shoot"
  as written (also doc 05 §5 and the schema comment).
- §3.3 emergency and same-day bookings: the bands paid in full at booking (T&C §2.2(b): SAME_DAY,
  HOURS_3_8, HOURS_UNDER_3). 100 % before a photographer accepts (CONFIRMED, DISPATCHING), nothing
  after (ASSIGNED, EN_ROUTE). An uncaptured sub-3-hour hold is released in full by payments.
- Not cancellable in the app:
  - after check-in (DOMAIN §2);
  - once the start time has passed — a late photographer is a no-show (T&C §3.6, a full refund
    plus a credit), which a cancellation would forfeit;
  - while a held payment is being captured or released (409 CANCEL_PAYMENT_SETTLING).
- `GET /bookings/:id/cancellation` quotes; `POST /bookings/:id/cancel` (idempotent) needs the quoted
  `expectedRefundPaise` once anything was paid and re-checks it under the booking lock (409
  CANCELLATION_TERMS_CHANGED). Unpaid bookings cancel as before; money captured on one anyway is
  refunded in full.

## D2 — Refunds decided by the rule
- The ladder's refund is the refunds module's row, straight to PROCESSING with no approver: the
  published rule is the decision, so there is no four-eyes. Addendum 0019 `refund_approved_or_by_rule`
  allows "no approver" only for (USER, CLIENT_CANCEL) and (SYSTEM, CLIENT_CANCEL or DATA_LOSS).
- Refunds still open on the booking (REQUESTED, or FAILED), except those a review settlement raised,
  are superseded: REJECTED `rejected_by_rule`, with a note. The quote counts their money as paid.
- It goes to the gateway after the commit. A crash or a thrown call raises a HIGH ops alert; the
  `refunds.send-sweep` job (every 2 min) looks the refund up by receipt and re-sends only 15 min
  after its **last** send (`last_sent_at`) — never blindly. Credit note and REFUND_ISSUED as usual.
- Payouts read the cancellation from its status event, never the outbox payload.

## D3 — The photographer's share (owner-overridable: `CLIENT_CANCELLATION_PAYOUT`)
No spec states it. After acceptance, the photographer is paid their share of what the client is
charged (doc 05 step 12, as ACCESS_DENIED): the full payout × kept ÷ booking total. Cancelled from
EN_ROUTE, their travel passes through as for the other outcomes. Before that, travel is shared like
the rest. The payout never exceeds what Clickco kept. Payout basis `CLIENT_CANCELLED` (addendum 0019),
due 3 days after the cancellation.

## D4 — No staff cancellation
DOMAIN §2 defines no ops or staff cancellation and no CANCELLED_OPS status. T&C §3.5/§3.6 describe
Clickco cancelling, but the state machine models only SYSTEM `DISPATCHING → CANCELLED_PRO`. A staff
route needs its own state-machine amendment.

## D5 — Messages
BOOKING_CANCELLED (client) and PRO_JOB_CANCELLED (the photographer who had accepted), version 1,
only for the client's own cancellation. Deploy: add both to `MSG91_TEMPLATES` (the SMS adapter
refuses to boot without every SMS template) and submit them to Meta and DLT.

## Owner questions
The photographer's share (D3); peak-season dates (OD-03, provisional).
