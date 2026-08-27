# CLICKCO — PRICING ENGINE SPEC
**Resolution algorithm, rate card, rounding rules, test matrix**
Doc 5 of N · 27 Aug 2026 · Implements the tables in `clickco-04-schema.sql` §5

---

## 1. Five principles

1. **Nothing is hardcoded.** Every number lives in a `pricing_ruleset`. Changing a price is a data operation performed by an admin, never a deploy.
2. **Quote once, snapshot forever.** A `booking_price_snapshots` row is immutable. A booking never reprices, even if the ruleset changes an hour later.
3. **Deterministic.** Same inputs plus same ruleset always yields the same output, to the paise. No randomness, no wall-clock reads inside the calculation — the "now" used for lead-time banding is passed in as a parameter.
4. **Integer paise, single rounding point.** Multipliers are basis points. Intermediate maths runs in a wider integer; rounding happens exactly once, per line item, at a documented step.
5. **Auditable.** Every snapshot stores the resolved factors *and* the rendered breakdown. In a dispute you can reconstruct the exact quote without re-running any code.

---

## 2. Inputs

```ts
interface PricingRequest {
  // resolution keys
  tier: PlanTier;
  categoryCode: string;
  cityId: string;
  venuePincode: string;

  // schedule
  scheduledStart: Date;      // absolute instant
  hours: number;             // >= 2.0, multiples of 0.5

  // context
  now: Date;                 // ← passed in, never read inside. testability.
  addons: Array<{ code: string; quantity: number }>;
  promoCode?: string;
  travelDistanceKm?: number; // if omitted, derived from pincode centroids

  // optional pin: repricing an old booking resolves to its original ruleset
  rulesetId?: string;
}
```

---

## 3. The algorithm

Twelve steps, in this exact order. Order matters — multipliers compose multiplicatively on the base, but addons and travel are **not** multiplied by surge or emergency.

### Step 1 — Resolve the ruleset
```
if request.rulesetId → load it (repricing an existing booking)
else → the ruleset where effective_from <= now AND (effective_to IS NULL OR effective_to > now)
```
If none, **hard fail**. Never fall back to a default. A missing ruleset is a configuration bug and must be loud.

### Step 2 — Resolve serviceability
```
area = serviceable_areas[venuePincode]
if not found or status = 'BLOCKED'  → reject: NOT_SERVICEABLE
if status = 'WAITLIST'              → reject: WAITLIST_ONLY (create waitlist_entry)
if status in ('LIVE','PILOT')       → proceed
cityTier = cities[area.city_id].tier
travelZone = area.travel_zone
```

### Step 3 — Validate duration
```
if hours < deliverable.min_hours   → reject: BELOW_MINIMUM
if (hours * 2) % 1 != 0            → reject: INVALID_INCREMENT
```
Minimum is 2.0 hours; increments of 0.5 thereafter.

### Step 4 — Resolve the base rate
```
rate = base_rates[ruleset, tier, cityTier].rate_per_hour_paise
if base_rates[...].is_quote_only  → return QUOTE_ONLY (Signature tier)
```

### Step 5 — Resolve the category uplift
Prefer the tier-specific row; fall back to the tier-agnostic row; default to 10000 (1.00×).
```
uplift = category_uplifts[ruleset, category, tier]
      ?? category_uplifts[ruleset, category, NULL]
      ?? 10000
```

### Step 6 — Resolve the emergency band
Computed from lead time, **not** chosen by the user. The UI reflects it; it does not set it.
```
leadHours = (scheduledStart - now) / 3600s

leadHours <  3   → HOURS_UNDER_3
leadHours <  8   → HOURS_3_8
leadHours < 24   → SAME_DAY
leadHours < 48   → NEXT_DAY
else             → NONE

emergencyBps = emergency_multipliers[ruleset, band].multiplier_bps
```
Boundaries are **exclusive at the top**: exactly 3.0 hours lead time is `HOURS_3_8`, not `HOURS_UNDER_3`. Document it, test it, and never let it drift — this boundary is worth ₹4,000 on a Professional booking.

### Step 7 — Resolve surge (festival calendar)
```
localDate = scheduledStart in Asia/Kolkata
rows = festival_calendar where ruleset AND localDate between date_from and date_to
                            AND (city_id IS NULL OR city_id = booking city)
surgeBps = max(rows.multiplier_bps)   ← MAX, never multiply overlapping rows
isPeakSeason = any(rows.is_peak_season)
```
**Take the maximum, don't stack.** Diwali overlapping wedding season must not produce 1.2 × 1.15 = 1.38×. `isPeakSeason` is carried into the snapshot because T&C §3.2 keys the cancellation ladder off it.

### Step 8 — Resolve night and weekend
```
localTime = scheduledStart in Asia/Kolkata

nightBps   = (localTime >= 22:00 OR localTime < 06:00) ? nightMultiplier : 10000
weekendBps = (isoDow(localDate) in weekendRow.iso_dow) ? weekendMultiplier : 10000
```
Night is judged on the **start** time only. A shoot starting 21:00 and running to 23:00 is not a night shoot. This is simple, explicable to a client, and avoids pro-rating arguments.

### Step 9 — Compute the base amount
This is the only place multipliers compose. Do it in one expression to avoid compounding rounding error.

```
baseAmount = round(
    rate
  × hours
  × (uplift       / 10000)
  × (emergencyBps / 10000)
  × (surgeBps     / 10000)
  × (nightBps     / 10000)
  × (weekendBps   / 10000)
)
```

Implemented in integer arithmetic:
```ts
const numerator = BigInt(rate)
  * BigInt(Math.round(hours * 10))     // 2.5h → 25
  * BigInt(uplift) * BigInt(emergencyBps) * BigInt(surgeBps)
  * BigInt(nightBps) * BigInt(weekendBps);

const denominator = 10n * 10000n ** 5n;

const baseAmount = roundHalfUp(numerator, denominator);   // ← single rounding
```

### Step 10 — Addons and travel (not multiplied)
```
for each addon:
  price = addon_prices[ruleset, addon, tier, cityTier]
       ?? addon_prices[ruleset, addon, tier, NULL]
       ?? addon_prices[ruleset, addon, NULL, NULL]
       → else reject: ADDON_NOT_PRICED

  if addon.min_tier and tier < min_tier   → reject: ADDON_TIER_INELIGIBLE
  if addon.requires_airspace_check        → flag for Digital Sky check, do not block the quote

  lineAmount = price.is_per_hour
    ? round(price.amount_paise × hours)
    : price.amount_paise × quantity

addonsAmount = Σ lineAmount
```

```
slab = travel_slabs[ruleset, cityTier, travelZone]
travelAmount = slab.flat_paise
             + round(slab.per_km_paise × max(0, distanceKm - slab.from_km))
             + (travelZone = 2 ? slab.overnight_paise : 0)
```

**Addons and travel are deliberately excluded from surge and emergency multipliers.** A drone doesn't cost 2.2× more at 2am, and charging as if it did is the kind of thing that shows up in a screenshot on Twitter.

### Step 11 — Discount, then tax
```
subtotal = baseAmount + addonsAmount + travelAmount

discount = resolvePromo(promoCode, subtotal, tier, cityId, userId)
         → capped at promo.max_discount_paise
         → capped at subtotal (never negative)

taxable = subtotal - discount
```

Then GST, per the ruleset's `prices_include_gst`:

```
if prices_include_gst = false          // EXCLUSIVE — recommended
    gst   = roundHalfUp(taxable × gstRateBps, 10000)
    total = taxable + gst

if prices_include_gst = true           // INCLUSIVE
    total   = taxable
    taxable = roundHalfUp(total × 10000, 10000 + gstRateBps)
    gst     = total - taxable          // ← derive by subtraction, never round twice
```

The inclusive branch derives GST by subtraction on purpose. Rounding both the base and the tax independently produces a total that's off by a paise, and a GST return that won't reconcile.

**Place of supply** determines the split. Photography is performance-based, so place of supply is the venue's state. Same state as Clickco's registration → CGST + SGST at half each. Different state → IGST at the full rate. Store all three columns; exactly one branch is non-zero.

### Step 12 — Expected payout, then write the snapshot
```
payoutBps = photographer.payout_share_override_bps
         ?? base_rates[ruleset, tier, cityTier].payout_share_bps

expectedPayout = roundHalfUp((baseAmount + addonsAmount) × payoutBps, 10000)
               + travelAmount        // travel passes through at 100%
```

Travel is a reimbursement, not margin — the photographer actually paid for the fuel. Passing it through in full is both fair and simpler to explain than a share of it.

Then insert the snapshot, denormalise `total_paise` / `advance_paise` / `balance_paise` onto `bookings`, and set `quote_expires_at = now + 15 minutes`.

---

## 4. Rounding

One rule, everywhere:

```ts
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (2n * denominator);
}
```

- **Half-up**, not banker's rounding. Consumers expect ₹0.50 to round up, and "we used banker's rounding" is not a conversation you want to have.
- **Round per line item**, then sum. Never round the total after summing unrounded lines — the snapshot's `CHECK` constraints enforce that the lines add to the total exactly.
- Everything is paise. Display rounds to the rupee only in the UI, using `Math.round`, never in the engine.

---

## 5. Launch rate card

Starting numbers. These are a defensible v1, not gospel — revise after 50 bookings of real data.

### `base_rates` — rate per hour, in rupees (store as paise)

| Tier | METRO (Mumbai) | TIER_1 (Surat, Vadodara) | TIER_2 | TIER_3 | Payout share |
|---|---|---|---|---|---|
| BASIC | ₹2,000 | ₹1,750 | ₹1,500 | ₹1,350 | 62% |
| SEMI_PRO | ₹3,200 | ₹2,750 | ₹2,400 | ₹2,100 | 62% |
| PROFESSIONAL | ₹5,000 | ₹4,250 | ₹3,700 | ₹3,200 | 60% |
| EXPERT | ₹8,200 | ₹7,000 | ₹6,100 | ₹5,300 | 58% |
| SIGNATURE | quote only | quote only | quote only | quote only | 55% |

At a 2-hour minimum in Surat, that's **Basic ₹3,500 · Semi-Pro ₹5,500 · Professional ₹8,500 · Expert ₹14,000** — matching the figures already in the app designs.

### `category_uplifts`

| Category | Multiplier | Rationale |
|---|---|---|
| PORTRAIT | 1.00× | baseline |
| EVENT | 1.00× | baseline |
| FOOD | 1.15× | styling time, lighting setup, reshoots per dish |
| PRODUCT | 1.10× | setup-heavy, but repetitive once lit |
| REAL_ESTATE | 1.10× | wide lenses, HDR bracketing, more frames |
| CORPORATE | 1.20× | headshot consistency, on-site constraints, higher expectations |
| WEDDING | 1.25× | unrepeatable, high stakes, physically demanding |

### `emergency_multipliers`

| Band | Lead time | Multiplier | Guaranteed | Capture behaviour |
|---|---|---|---|---|
| NONE | > 48 h | 1.00× | yes | standard 50/50 |
| NEXT_DAY | 24–48 h | 1.20× | yes | standard 50/50 |
| SAME_DAY | 8–24 h | 1.40× | yes | **100% upfront** |
| HOURS_3_8 | 3–8 h | 1.80× | yes | 100% upfront |
| HOURS_UNDER_3 | < 3 h | 2.20× | **no — best effort** | **authorise only, capture on accept** |

`HOURS_UNDER_3` sets `capture_on_accept_only = true`, `is_guaranteed = false`, `auto_refund_minutes_before = 90`. Doc v0.2 §8 and T&C §3.7 describe the same behaviour — this is where it's enforced.

### `time_multipliers`

| Kind | Window | Multiplier |
|---|---|---|
| NIGHT | 22:00 – 06:00 IST (start time) | 1.25× |
| WEEKEND | Sat, Sun (ISO 6, 7) | 1.10× |

### `festival_calendar` — seed 24 months

| Label | Window | Multiplier | Peak season |
|---|---|---|---|
| Wedding season | 1 Nov – 28 Feb | 1.15× | ✅ |
| Diwali week | per year | 1.25× | ✅ |
| Navratri (Gujarat) | per year, Surat + Vadodara only | 1.20× | ✅ |
| Christmas–New Year | 24 Dec – 2 Jan | 1.20× | ✅ |
| Valentine's | 12–15 Feb | 1.15× | ❌ |
| Ganesh Chaturthi (Mumbai) | per year, Mumbai only | 1.15× | ❌ |

**`is_peak_season` is load-bearing.** T&C §3.2 says 50% of the advance is forfeited on cancellation inside 7 days during Peak Season. That flag is the definition. Publish the dates in-app at booking time or the clause is unenforceable.

### `travel_slabs`

| Zone | Distance | Flat | Per km beyond | Overnight |
|---|---|---|---|---|
| 0 | 0–15 km | ₹0 | ₹0 | — |
| 1 | 15–40 km | ₹200 | ₹18/km beyond 15 | — |
| 2 | 40 km+ (outstation) | ₹800 | ₹22/km beyond 40 | ₹1,500 |

### `addon_prices`

| Addon | Price | Per hour | Min tier | Notes |
|---|---|---|---|---|
| SECOND_SHOOTER | ₹1,500/hr | ✅ | SEMI_PRO | payout share 62% |
| DRONE | ₹4,500 | ❌ | PROFESSIONAL | requires DGCA RPC + UIN + airspace check |
| LIGHTING_KIT | ₹1,500 | ❌ | SEMI_PRO | |
| RUSH_24H | ₹2,500 | ❌ | PROFESSIONAL | 24h delivery instead of 48h |

### `extension_rates`

Extension hourly = **base hourly × category uplift**, no emergency or surge multiplier. The client already committed at the original rate; surging an extension mid-shoot is indefensible.

Waiting time = **60% of the extension hourly**, after a 15-minute grace period (T&C §2.6). The photographer is present but not working.

---

## 6. GST: inclusive or exclusive — my recommendation

This is still open, and it's the last thing blocking the rate card.

**Recommend `prices_include_gst = false` (exclusive), with the total shown prominently.**

| | Exclusive (recommended) | Inclusive |
|---|---|---|
| Displayed | "₹8,500 + GST" → total ₹10,030 | "₹8,500 all-inclusive" |
| Perceived price | Lower headline | Higher headline |
| Margin clarity | Clean — service revenue is exactly ₹8,500 | Muddier — every rate is 84.75% of itself |
| Rate card revision | Simple | Every number is a weird figure |
| B2B clients | **Expect exclusive.** Standard in Indian B2B. | Reads amateurish |
| Consumer surprise | Real risk at checkout | None |

Given food, product, corporate and real-estate photography are your highest-margin categories and all skew B2B, exclusive is the right default.

**Mitigate the consumer surprise properly:** show `₹8,500 + GST` in listings, and show `₹10,030 total` in the same visual block, not on a later screen. The quote review screen already itemises GST as a separate line — that's the pattern. What you must never do is show ₹8,500 through three screens and reveal ₹10,030 at payment.

---

## 7. The snapshot format

`booking_price_snapshots.breakdown` stores the client-facing rendering, verbatim. Not a recomputation hint — the actual thing they saw.

```json
{
  "currency": "INR",
  "pricesIncludeGst": false,
  "lines": [
    { "code": "BASE", "label": "Professional · Food · 2 hours",
      "detail": "₹4,250/hr × 2 hrs", "amountPaise": 977500 },
    { "code": "SURGE", "label": "Wedding season", "isFactor": true,
      "factorBps": 11500 },
    { "code": "ADDON_DRONE", "label": "Drone coverage", "amountPaise": 450000 },
    { "code": "TRAVEL", "label": "Travel (18 km)",
      "detail": "Zone 1", "amountPaise": 25400 },
    { "code": "DISCOUNT", "label": "FIRST200", "amountPaise": -20000 }
  ],
  "subtotalPaise": 1432900,
  "gst": { "rateBps": 1800, "sac": "998383",
           "placeOfSupply": "24", "cgstPaise": 128961, "sgstPaise": 128961,
           "igstPaise": 0 },
  "totalPaise": 1690822,
  "advancePaise": 845411,
  "balancePaise": 845411,
  "factorsApplied": {
    "categoryUpliftBps": 11500, "emergencyBps": 10000,
    "surgeBps": 11500, "nightBps": 10000, "weekendBps": 10000
  },
  "rulesetVersion": "2026.09.01",
  "computedAt": "2026-09-04T11:22:31.442Z"
}
```

Every factor that moved the number is recorded, including the ones that were 1.00×. When a client asks why their Saturday shoot cost more than their friend's Tuesday shoot, this JSON is the answer.

---

## 8. Advance split

| Emergency band | Advance | Balance | Behaviour |
|---|---|---|---|
| NONE, NEXT_DAY | 50% | 50% | Balance invoiced after check-out. Media withheld until cleared. |
| SAME_DAY, HOURS_3_8 | 100% | 0% | No time to invoice a balance before delivery |
| HOURS_UNDER_3 | 100% authorised | 0% | Captured only on photographer acceptance; released in full if unfilled |

Rounding the 50/50: `advance = ceil(total / 2)`, `balance = total - advance`. The advance absorbs the odd paise. Never let the two computed halves fail to sum to the total — the `bookings` CHECK constraint will reject the row, which is the point.

---

## 9. Chart of accounts

The ledger accounts referenced by `ledger_entries.account`:

| Account | Type | Moves when |
|---|---|---|
| `CASH_GATEWAY` | Asset | Payment captured, refund paid, payout sent |
| `CLIENT_RECEIVABLE` | Asset | Invoice issued, payment received |
| `REVENUE_SERVICE` | Income | Service delivered |
| `REVENUE_TRAVEL` | Income | Travel billed |
| `GST_OUTPUT_PAYABLE` | Liability | GST accrued on issue, cleared on filing |
| `VENDOR_PAYABLE` | Liability | Vendor invoice raised, cleared on payout |
| `TDS_PAYABLE` | Liability | Withheld on payout, cleared on deposit |
| `COGS_VENDOR` | Expense | Vendor invoice raised |
| `GATEWAY_FEES` | Expense | Payment captured |
| `REFUNDS_ISSUED` | Contra-income | Refund completed |
| `CLIENT_CREDITS_LIABILITY` | Liability | Credit issued, redeemed |
| `SLA_REMEDY_EXPENSE` | Expense | Breach remedy applied |

Worked example — advance captured on a ₹16,908.22 booking (₹8,454.11 advance):

```
txn_kind = ADVANCE_CAPTURED, txn_id = <uuid>
  DEBIT   CASH_GATEWAY            845411
  CREDIT  CLIENT_RECEIVABLE       845411

txn_kind = GATEWAY_FEE, txn_id = <uuid>
  DEBIT   GATEWAY_FEES             16908     (2% + GST)
  CREDIT  CASH_GATEWAY             16908
```

Revenue and GST are recognised at **invoice issue**, not at payment. That's what keeps your GSTR-1 reconcilable against the ledger.

---

## 10. Test matrix

Sprint 2 is test-first. Every row below is a required case before implementation begins.

**Base resolution (12)** — each tier × each city tier resolves; missing combination fails loudly; Signature returns QUOTE_ONLY; unknown category rejects.

**Duration (7)** — 1.9h rejects · exactly 2.0h passes · 2.5h passes · 2.3h rejects · 2.25h rejects · 12h passes · negative rejects.

**Emergency boundaries (10)** — lead time of exactly 3.0h → `HOURS_3_8` · 2.999h → `HOURS_UNDER_3` · exactly 8.0h → `SAME_DAY` · exactly 24.0h → `NEXT_DAY` · exactly 48.0h → `NONE` · 48.001h → `NONE`. Each band's multiplier and capture behaviour asserted.

**Night boundaries (6)** — 21:59 not night · 22:00 night · 05:59 night · 06:00 not night · 23:00 start running past midnight is one night shoot, not two · DST is not a thing in IST but the timezone conversion is still asserted.

**Surge (6)** — single festival applies · two overlapping festivals take the MAX, never the product · city-scoped festival does not apply to another city · `is_peak_season` propagates to the snapshot · date boundaries inclusive on both ends.

**Travel (8)** — 0 km → ₹0 · exactly 15.00 km → zone 0, ₹0 · 15.01 km → zone 1 · 18 km → flat + 3 km × per-km · exactly 40.00 km → zone 1 · 40.01 km → zone 2 with overnight · missing slab fails loudly.

**Addons (7)** — per-booking vs per-hour · tier ineligibility rejects · quantity > 1 · drone flags airspace check without blocking the quote · unpriced addon rejects · addons are NOT multiplied by surge · addons are NOT multiplied by emergency.

**GST (9)** — exclusive path · inclusive path derives by subtraction · CGST/SGST split intra-state · IGST inter-state · exactly one branch non-zero · line items sum to taxable · taxable + tax = total · a total that would round to a half-paise · 0% edge case.

**Rounding (6)** — half-up at .5 · every line rounded before summing · the snapshot CHECK constraints hold on a deliberately awkward input like 2.5h × 1.15 × 1.15 × 1.10 · no float appears in any intermediate · BigInt overflow at 12 hours × Signature-scale rates.

**Snapshot integrity (5)** — UPDATE on a snapshot throws · sequence 2 created for an extension without touching sequence 1 · a booking priced under ruleset A reprices to ruleset A after B is published · breakdown JSON round-trips · advance + balance = total exactly.

**Promo (6)** — percentage · flat · max cap applied · discount cannot exceed subtotal · per-user cap enforced · expired code rejects.

**82 cases.** That's the price of a pricing engine you can trust. Every one of them is cheaper to write now than to debug against a real refund request.

---

## 11. Admin editing rules

Guard rails for the pricing editor screen in the admin panel:

- Rulesets are **drafted, previewed, then published**. A draft has `published_at IS NULL` and cannot price a booking.
- Publishing sets `effective_from` and closes the previous ruleset's `effective_to`. The partial unique index in the schema guarantees only one open-ended ruleset exists.
- Publishing requires the `FINANCE` role and 2FA.
- The editor includes a **live calculator**: pick a tier, category, city, date, time and duration and see the resulting quote against the draft ruleset before publishing. Non-negotiable — publishing a rate card blind is how you accidentally sell Expert weddings at Basic prices.
- A **diff view** against the current ruleset, showing every changed cell.
- Every publish writes an `audit_logs` row with the full before/after ruleset.
- **In-flight bookings are never affected.** They hold their `ruleset_id`.
- Never delete a ruleset. Close it.

---

## 12. Still open

1. **GST inclusive or exclusive.** My recommendation is exclusive (§6). Last blocker on the rate card.
2. **Sign-off on the launch numbers** in §5 — particularly the payout shares, since they set your contribution margin directly.
3. **Signature tier quoting** — is it a fully manual quote written by ops, or a template with a multiplier on Expert? Manual is simpler and Signature will be low-volume.
4. **Festival dates for FY 2026-27 and 2027-28** — needs an actual calendar, not placeholders, because peak-season cancellation terms depend on it.
5. **Clickco Edit pricing** — per 50 photos, or flat per booking? Feeds the upsell screen already in the designs.

---

*Next up, per your ordering: admin panel screens, then the marketing site with the programmatic city × category structure.*
