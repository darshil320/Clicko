# ADR-0026 — Sprint 10: money, supply and customer-care desks, built the way standard companies do

**Status:** Accepted 30 Oct 2026. Darshil's instruction (30 Oct): where an owner or CA answer is
still missing, "use what standard companies would use", and make the panel "really good, standard,
modern, simple … like Urban Company and modern startups, user-friendly". Every number below is a
named constant or a per-row column, so the CA's ruling changes configuration, not code.
**Builds on:** ADR-0005 (refund ceiling, equipment cap), ADR-0016 (breach remedy table, D9),
ADR-0025 (staff panel, audit, roles), doc 05 §5 (rulesets), v0.2 G-33, SA-01, SA-02, SA-21.

## D1 — Refunds: maker–checker, executed through the gateway
- **Who:**
  - Ops, support, the QM, city managers and finance may *request* a refund, with a reason code
    and a note.
  - The QM approves up to the lower of ₹5,000 or 50 % of the booking total (ADR-0005).
  - FINANCE (and SUPER_ADMIN) approves any amount.
  - **The approver must not be the requester** (four-eyes, standard for payouts and refunds).
- **States:** REQUESTED → APPROVED → PROCESSING → PROCESSED or FAILED, or REJECTED.
- **Amount:** never more than the payment's captured amount minus what has already been refunded.
- **Execution:** through the payment gateway port (sandbox now, Razorpay Refunds API with keys).
  The ledger posts `REFUND_ISSUED` when the gateway confirms.
- **GST credit notes (CGST Act s.34):** a refund that reduces an already-invoiced supply issues a
  credit note in its own series, `CN/<FY>/<seq>` (e.g. `CN/2026-27/000041`).
  - It references the original invoice and splits taxable value and CGST + SGST or IGST in the
    invoice's proportion, to the paisa.
  - Invoices are never edited.
  - New table `credit_notes` (addendum 0005).
  - A credit note can be issued up to 30 Nov after the financial year ends (s.34(2)). The desk
    warns when one is late.

## D2 — Settling review items and credits
- **Review items** are the `*.needs_review` and `ops.alert` events: `REFUND_DUE_*`,
  `*_CREDIT_25`, `ACCESS_DENIED_CHARGE_50`, `CLIENT_NON_ATTENDANCE`, `SLA_BREACH_REMEDY`, capture
  anomalies and similar.
  - Each is settled exactly once with an outcome (refund requested, credit issued, charge raised,
    no action) and a note.
  - New append-only table `review_resolutions` (addendum 0006). The alert feed then shows open
    items versus settled ones.
- **Client credits:** in paise, valid **12 months**, used at checkout (S11 wires it in). Issued by
  the QM or finance, with a reason; an issued credit cannot be withdrawn.
- **Breach remedies** use the ADR-0016 table (standard credit-first compensation, as consumer
  apps do). Only breaches that are still owed (`isOwed`, ADR-0025) are settled:
  - CREDIT goes to a client credit;
  - PARTIAL_REFUND or FULL_REFUND becomes a refund request (D1);
  - the payout deduction is recorded against the photographer's payout (D3).
  - Applying a remedy sets `applied_at`.

## D3 — Payouts and TDS
- **Cadence:**
  - A payout falls due **3 days after delivery** (v0.2; `payouts.eligible_at`).
  - Finance runs a **weekly batch every Monday** (IST) for everything due by then. Off-cycle
    batches are allowed.
- **Amount:** expected payout + extension and waiting shares − recorded breach deductions −
  penalties not waived − TDS. Never negative; a shortfall carries forward to the next batch.
- **TDS, until the CA rules:**
  - **Section 194C:** Clickco sells the shoot to the client and the photographer works for
    Clickco under the vendor agreement.
  - **Rate:** 1 % for individuals and HUFs, 2 % for anyone else, **20 % without a valid PAN**
    (s.206AA).
  - **Threshold:** nothing is deducted while each payment is ≤ ₹30,000 and the financial year's
    total is ≤ ₹1,00,000. Once the year's total crosses ₹1,00,000, TDS applies to the whole
    year's amount, recovered on that payout. This is the standard 194C rule.
  - Section and rate are stored on every payout row (`tds_section`, `tds_rate_bps`).
  - Switching to 194J or a new rate is a constant change.
- **Disbursal:**
  - Until RazorpayX keys exist, the batch exports a **bulk-NEFT bank file (CSV)**. Finance marks
    each payout paid with the bank's UTR.
  - Finance downloads a **monthly TDS report** (deposit by the 7th; the CA files 26Q quarterly
    and issues Form 16A).
- **Vendor invoices:** photographers are generally unregistered for GST (below the threshold). A
  self-billed payout statement is generated per batch. Registered photographers' tax invoices
  are recorded in `vendor_invoices`.

## D4 — Pricing editor
- **Lifecycle:** draft → preview → publish, as doc 05 specifies.
  - A draft is a full copy of the live ruleset (`published_at IS NULL`).
  - Finance edits base rates, category uplifts, add-ons, extension rates and surge or festival
    entries.
  - The live **quote calculator runs against the draft**.
  - A **diff** shows every change, with the before and after amounts in ₹.
- **Publishing:**
  - It requires FINANCE (or SUPER_ADMIN) **and a fresh authenticator code** (step-up: entered
    within the last 5 minutes).
  - It closes the previous ruleset (`effective_to`) and writes an audit row with the full before
    and after.
  - Rulesets are never deleted. Bookings keep their own ruleset (Invariant 17).

## D5 — Supply: onboarding, KYC, photographers, penalties
- **Onboarding:** a kanban over `photographer_applications` stages, with each move written to
  `photographer_application_events` (append-only).
- **KYC:**
  - Documents are approved or rejected with a reason.
  - A document opens only through a **5-minute signed link** from the StoragePort, and **every
    view is audited** (doc 06).
  - No Aadhaar numbers, ever.
- **Photographer directory:** status, tier, categories, metrics and penalties.
  - City managers and the QM may **waive a penalty** with a reason, for example the verified
    emergency waiver (ADR-0013) or reversing a no-show after a late offline check-in.

## D6 — Customer care: quality, grievances, equipment claims
- **QM queue (`quality_escalations`):**
  - Outcomes are CREDIT, RESHOOT, PARTIAL_REFUND or NO_ACTION.
  - Money outcomes raise a review item that D2 settles, so every rupee passes through the same
    approvals.
  - A QM decision closes the escalation and the booking (DOMAIN: QUALITY_ESCALATION → CLOSED).
- **Grievance tickets (SA-02, Consumer Protection (E-Commerce) Rules 2020):**
  - Acknowledge within **48 hours**, resolve within **30 days**.
  - Deadline badges turn amber when close and red when overdue.
  - Replies are append-only messages. Every ticket shows its deadlines.
  - The client's in-app entry point is S11.
- **Equipment claims (SA-01):**
  - A claim is assessed and approved up to the **₹2,00,000 cap** (OD-08).
  - An approved claim raises a finance review item for payment.

## D7 — Staff passwords
- Temporary passwords **expire after 72 hours**.
- The first sign-in with one forces a **new password**: at least 12 characters, not the email, not
  the temporary one.
- A SUPER_ADMIN can reset a password, which issues a new temporary password and revokes every
  session.
- New `staff_users` columns are in addendum 0007.

## D8 — The panel's UX: modern, simple, friendly
The bar is the consumer-grade products ops teams already know (Urban Company, Stripe, Linear).
- **Home is "Today":**
  - a greeting;
  - five or six live numbers (shoots today, in progress, deliveries due, waiting for QA, open
    tickets, money waiting for approval);
  - **"Needs you"** cards, one per desk with work in it, each with its count and one button.
- **Navigation:**
  - Grouped sidebar: Operations, Money, Supply, Customer care, Admin.
  - **Live counts** next to desks that have work.
  - It collapses to a drawer on small screens.
- **⌘K / Ctrl+K:** jump to any desk, or find a booking by reference, phone or client name. Built
  on the kit's Radix dialog; no new dependency.
- **Plain language:**
  - No raw codes on screen.
  - ₹ with Indian grouping, "in 2 h" and "3 days ago" next to exact IST times.
  - Every confirm dialog says what will happen ("₹2,500 goes back to Priya Sharma's card").
- **One primary action per screen:**
  - Quick actions open in a **side sheet** over the list.
  - Long records get their own page.
  - Empty states say what is done ("All caught up").
- **Responsive and accessible:** the panel works on a laptop and a tablet, with full keyboard
  use, visible focus and AA contrast.

## D9 — How the work is split (ownership, so parallel work never collides)
| Stream | Owns |
|---|---|
| **A — Money** | reviews + refunds + credit notes + credits + breach remedies. Contracts `admin-money.ts`; client `admin-money-client.ts`; API `modules/refunds` (new) + review resolutions; desks `reviews`, `refunds`; addenda/migrations 0005, 0006. |
| **B — Payouts** | payouts, batches, TDS, bank file, TDS report, payout statements. Contracts `admin-payouts.ts`; client `admin-payouts-client.ts`; API `modules/payouts` (new); desk `payouts`. |
| **C — Supply & care** | onboarding, KYC, photographer directory, penalty waivers, QM queue, tickets, equipment claims. Contracts `admin-supply.ts`, `admin-care.ts`; clients `admin-supply-client.ts`, `admin-care-client.ts`; desks `photographers`, `quality`, `tickets`, `claims`. |
| **D — Pricing** | pricing editor + step-up TOTP. Contracts `admin-pricing.ts`; client `admin-pricing-client.ts`; desk `pricing`. |
| **E — Platform & UX** | the shell, grouped nav, live counts, ⌘K, the Today home (`GET /admin/overview` gathers counts from a provider registry each stream adds to), password lifecycle (addendum/migration 0007), ui-web additions and the design pass. |

- Shared files (`access.ts`, the API's `roles.ts`, the nav list) are pre-filled before the
  streams start.
- `admin.module.ts` and `ui-web/src/index.ts` take one-line additions only.
