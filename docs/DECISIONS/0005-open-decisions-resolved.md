# ADR-0005 — Open decisions resolved on Darshil's behalf

**Status:** Accepted 21 Oct 2026 — each row is overridable; say which and it gets a superseding ADR.
**Source:** `docs/OPEN-DECISIONS.md` OD-01 … OD-12.

| OD | Decision | Why |
|---|---|---|
| OD-01 GST | **Exclusive.** `pricing_rulesets.prices_include_gst = false`. Listings show "₹8,500 + GST" with the GST-inclusive total in the *same* visual block; never revealed later. T&C §2.5 → "exclusive". | Doc 05 §6. B2B-heavy categories expect exclusive; clean margins; also the only branch the schema's `snapshot_totals_balance` CHECK supports (PLAN §6 SA-09). |
| OD-02 Rate card | **Doc 05 §5 adopted as launch ruleset `2026.10.01`** (effective 1 Oct 2026 so staff test bookings and dry runs price against it), payout shares included (62/62/60/58/55%). Revisit after 50 real bookings. | Doc 05 calls it a defensible v1; headline prices already match designs. |
| OD-03 Festival dates | **Provisional seed below.** Lunar dates must be verified against Drik Panchang (PLAN B15) before T&C publish. | `is_peak_season` is load-bearing for T&C §3.2. |
| OD-04 Signature | **Fully manual ops quote.** `base_rates.is_quote_only = true`; enquiry → ops call → custom quote → 50% advance. | Doc 05 §12; low volume. |
| OD-05 Clickco Edit | **Per-50-photo blocks, ₹2,500 per block** (matches "from ₹2,500" in Screen 10 and v0.2 §2 "priced per 50 photos"). **Not built for launch:** the Screen 10 upsell captures interest and ops fulfils manually; `clickco_edit_orders` / `edit_queue` scoped after launch. | Keeps the launch path short; validates demand before building an editor queue. |
| OD-07 Jurisdiction | **Surat, Gujarat.** | Already the de facto answer in v0.2 and T&C. |
| OD-08 Equipment cap | **₹2,00,000 per incident**; claims recorded in `equipment_claims` (schema addendum 0002). | T&C inline recommendation; closes SA-01. |
| OD-10 Advance < 24 h | **Doc 05 §8 confirmed:** NONE/NEXT_DAY 50/50; SAME_DAY/HOURS_3_8 100% upfront; HOURS_UNDER_3 100% authorise-only, capture on accept, auto-release at T-90 min. | Already implemented downstream. |
| OD-11 Video | **Photos only at launch.** All `plan_deliverables.video_included = false`; `VIDEO` asset kind and pipeline stay in the schema, feature-flagged off. Revisit once the Drive tripwire is measured. | Video drove the 32 GB/event maths; dropping it at launch roughly halves storage and simplifies gear vetting. *Confirm — PLAN §8 Q3.* |
| OD-12 Quality Manager | **Ceiling without escalation: the lower of ₹5,000 or 50% of the booking total**, per escalation, as refund or credit. Above → `FINANCE` approval. Person TBD by S9. Until then `SUPER_ADMIN` holds the role. | Unblocks the RBAC matrix; number is easy to change in config. |

**Still needs Darshil:** OD-06 (legal entity + address) and OD-09 (Grievance Officer). Neither can be decided on anyone's behalf.

## Provisional festival calendar (ruleset `2026.10.01`)

`PROVISIONAL` = lunar/regional date, verify before publishing. Fixed-date rows are final.

| Label | From | To | City scope | × | Peak | Status |
|---|---|---|---|---|---|---|
| Wedding season 26-27 | 2026-11-01 | 2027-02-28 | all | 1.15 | ✅ | final |
| Diwali week 2026 | 2026-11-06 | 2026-11-11 | all | 1.25 | ✅ | PROVISIONAL |
| Christmas–New Year 26-27 | 2026-12-24 | 2027-01-02 | all | 1.20 | ✅ | final |
| Valentine's 2027 | 2027-02-12 | 2027-02-15 | all | 1.15 | ❌ | final |
| Ganesh Chaturthi 2027 | 2027-09-04 | 2027-09-14 | Mumbai | 1.15 | ❌ | PROVISIONAL |
| Navratri 2027 | 2027-09-30 | 2027-10-08 | Surat, Vadodara | 1.20 | ✅ | PROVISIONAL |
| Diwali week 2027 | 2027-10-26 | 2027-10-31 | all | 1.25 | ✅ | PROVISIONAL |
| Wedding season 27-28 | 2027-11-01 | 2028-02-29 | all | 1.15 | ✅ | final (2028 is a leap year) |
| Christmas–New Year 27-28 | 2027-12-24 | 2028-01-02 | all | 1.20 | ✅ | final |
| Valentine's 2028 | 2028-02-12 | 2028-02-15 | all | 1.15 | ❌ | final |

Navratri 2026 (Oct) and Ganesh Chaturthi 2026 (Sep) fall before launch and are omitted. Overlaps (Diwali inside wedding season, Christmas inside wedding season) resolve by **MAX**, never product (DOMAIN Invariant 20).
