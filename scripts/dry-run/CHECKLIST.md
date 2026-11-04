# The 10 staff dry-run bookings (ADR-0029 D5)

Ten real bookings, each run by people on the real apps (EAS preview builds of Clickco and
Clickco Pro), the photographer portal and the admin panel. Each one exercises one variant on top
of the normal flow. **S12 passes** when all ten pass, and run 1 passes twice in a row with nothing
fixed in between.

## Before each session

- [ ] The target is up and `scripts/dry-run/run.ts` passed on it today (README.md).
- [ ] Where:
  - until staging can take uploads (ADR-0029 D1), the dev-mode stack: OTP codes from the console
    log or `/dev/otp`, payments through the app's "Simulate payment" button (dev builds only);
  - once staging can: Razorpay test mode and real SMS to the staff phones.
- [ ] People:
  - **Ops**: the owner, on the admin panel;
  - **Finance**: a second FINANCE or SUPER_ADMIN account, needed for four-eyes refunds, credits
    above ₹5,000 and payouts;
  - **Client**: two people with their own phones;
  - **Photographer**: two vetted photographers, on Pro and the portal.
- [ ] A terminal tails the API log, filtered for `error_report` and `[dev only]` (each message the
  console adapters would have sent shows as `[dev only] <CHANNEL> <TEMPLATE> → +91•••••1234`).
- [ ] A results sheet: run #, booking reference, step, expected, seen, PASS / FAIL / BLOCKED,
  ticket link.

## What every run checks (on top of its own list)

1. **States:** the booking timeline (admin → Bookings → the booking) shows each state in order,
   with the right actor (USER, PHOTOGRAPHER, STAFF, SYSTEM).
2. **Messages:** each lifecycle message appears once in the log, to the right person:
   BOOKING_CONFIRMED, PHOTOGRAPHER_ASSIGNED, PHOTOGRAPHER_ON_THE_WAY, CHECKED_IN, CHECKED_OUT,
   BALANCE_DUE, DELIVERED, plus the run's own. Push only for the Pro offer (PRO_NEW_OFFER).
3. **Money, to the paise:** the quote matches the rate card (doc 05 §5). On the admin booking
   page (Money):
   - the advance and balance invoices add up to the total, GST shown;
   - every payment has its ledger rows;
   - the photographer's payout is accrued (Payouts desk) with the right basis and amount.
4. **Desks:** every staff action leaves an audit row (admin → the booking → Audit). An
   `ops.alert` shows on Today and Alerts when the run says so, and on no other run.
5. **Errors:** no `error_report` line in the log during the run.
6. **Client app:** each screen shows the state it should. Offline, error and empty states make
   sense if the network drops.

A step marked **[APP GAP]** needs a screen that is not built yet (docs/store/README.md §4 B7). A
step marked **[API GAP]** needs a route that does not exist yet (ADR-0029 follow-ups). Record
these as BLOCKED, not FAIL, and run the rest of the booking.

---

## Run 1: the standard flow, with an extension

**Variant:** a one-hour extension, approved by the client.
1. Client: book Professional · Food · 2 h, at least 2 days ahead (50 % advance), and pay the
   advance.
2. Ops: Dispatch desk: watch wave 1. Photographer: accept in Pro.
3. On the day: Photographer: en route, check in at the venue, start.
4. Photographer: request a one-hour extension. Client: approve it **[APP GAP]: the client app has
   no approve button yet**. Expect EXTENSION_REQUESTED to the client, and a new price snapshot
   with the extension in the balance.
5. Photographer: check out after 3 h, then upload the card in the portal.
6. Ops: QA desk → Pass. Client: pay the balance. Expect DELIVERED with the link. Open it on a
   phone browser: `/d/<token>` lists the files, and a RAW downloads.
7. Client: rate 5 stars with a comment **[APP GAP]: no review screen yet**.

**Pass if:** every state is reached; balance = the 50 % remainder + the extension, to the paise;
the payout includes the extension share and falls due by the ADR-0027 rules; delivery lands
inside 48 h of check-out, with the clock paused while the balance was due.

## Run 2: cancellation

1. Client: book and stop at the payment screen, then cancel. Expect CANCELLED_CLIENT, no
   money, and the promo redemption (if any) freed.
2. Client: book and pay a second booking, then try to cancel it in the app. **[API GAP]: a paid
   booking cannot be cancelled by anyone yet** (`CANCEL_NOT_AVAILABLE`). Once the route exists,
   cancel one booking in each band of the T&C §3.1 ladder: over 72 h out (100 % of the advance
   back), 24–72 h (50 %), under 24 h (nothing). Then one under 7 days out in peak season (§3.2:
   50 % forfeited; ADR-0005's provisional dates), and an emergency booking before and after a
   photographer accepts (§3.3).
3. Also check: a booking left unpaid past its quote expiry + 30 min is cancelled by the stale
   sweep (`PAYMENT_WINDOW_EXPIRED`, every 5 minutes).

**Pass if:** step 1 and step 3 behave as described, and each refund matches the ladder to the
paise.

## Run 3: access denied

1. Standard booking up to check-in. Photographer: "Access denied" in Pro, with a note.
2. Ops: Incidents desk → confirm ACCESS_DENIED.

**Pass if:**
- an `assignment.access_denied_reported` HIGH alert shows;
- the booking ends ACCESS_DENIED, with 50 % of the booking value charged (T&C §7.2);
- the payout accrues at half (`basis` ACCESS_DENIED), with travel at 100 %;
- the client sees what happened.

## Run 4: data loss

1. Standard booking through upload. Then the photographer reports that the card failed after a
   partial upload.
2. Ops confirms DATA_LOSS. **[API GAP]: no staff route reaches DATA_LOSS yet** (HANDOVER §4).

**Pass if (once the route exists):**
- a full client refund for a complete loss, or a pro-rata one for a partial loss;
- the full payout, `basis` DATA_LOSS;
- a third loss in 365 days writes the payout WITHHELD with an alert;
- Finance releases it with a fresh authenticator code, and the release is audited.

## Run 5: refund

1. A delivered booking from run 1, or a new one. Support: booking page → Refund: ₹1,000, with
   a reason.
2. The **same** person tries to approve it: refused. Finance (another person): approve.
   Expect REFUND_ISSUED to the client.
3. A refund that takes the booking above the QM ceiling needs the approver's fresh
   authenticator code.

**Pass if:** four-eyes holds; the refund settles through the sandbox webhook; the client's
"Refunds & credits" shows PROCESSING, then REFUNDED; the ledger and a GST credit note match.

## Run 6: credit

1. Ops: booking page → Issue credit, ₹500. Expect CREDIT_ISSUED, and the credit with its expiry
   in the client's "Refunds & credits".
2. Issue ₹6,000: it needs a second FINANCE or SUPER_ADMIN, with their sign-in email and own
   code, in the same request. Resend the identical request (same key): no second credit.
3. Client: book again and see the credit applied at checkout.

**Pass if:** both credits are correct and audited (the co-approver is named); the next booking
uses the credit to the paise.

## Run 7: quality issue

1. Client: a delivered booking → "Report a problem with my photos" within 30 days. Expect
   QUALITY_ESCALATION, and the issue on the Quality desk.
2. Quality manager: take it, then resolve it with a partial credit (or a free edit, or no
   action).
3. Client: report again on the same booking: refused (once per booking).

**Pass if:** the photographer's payout is untouched (paid in full regardless, DOMAIN §2); the
remedy matches what the QM chose; the booking ends CLOSED.

## Run 8: support ticket

1. Client: Help → new ticket about a booking, 10–2,000 characters. Expect TICKET_RECEIVED with
   the reply-by time (48 h).
2. Support: Tickets desk → acknowledge, reply, resolve with a summary.
3. Client: raise 6 tickets in a day: the 6th is refused.

**Pass if:**
- the 48 h acknowledgement and 30-day resolution clocks show;
- the client reads the resolution summary in the app;
- no message carries the ticket's text.
- Known gap: no TICKET_RESOLVED message or acknowledgement message exists yet (ADR-0027 D5a).

## Run 9: block

1. After run 1, the client blocks that photographer **[APP GAP]: no block button yet**.
2. Client: book the same plan, city and time slot again.

**Pass if:**
- the blocked photographer is never offered the booking (Dispatch desk);
- an offer already open when the block lands is withdrawn (`dispatch.offer_withdrawn`,
  CLIENT_BLOCKED);
- a late accept is refused.

## Run 10: moderation

1. Client: review a delivered booking with a phone number and a link in the comment **[APP GAP]**.
   Expect the published text with both stripped.
2. Photographer (or a second client): report the review **[APP GAP]**. Expect it on the
   Moderation desk. Editing the review is refused while the report is open.
3. Quality manager: decide **Keep** on one report, **Hide** on another, **Warn** the user on a
   third.

**Pass if:**
- a hidden review leaves the photographer's rating (it is recomputed);
- a kept review can no longer be edited;
- every decision is audited.
- Known gap: the warned user gets no message yet (ADR-0027 D4a).

---

## Results

| Run | Date | Booking | Result | Tickets |
| --- | ---- | ------- | ------ | ------- |
| 1   |      |         |        |         |
| 2   |      |         |        |         |
| 3   |      |         |        |         |
| 4   |      |         |        |         |
| 5   |      |         |        |         |
| 6   |      |         |        |         |
| 7   |      |         |        |         |
| 8   |      |         |        |         |
| 9   |      |         |        |         |
| 10  |      |         |        |         |
