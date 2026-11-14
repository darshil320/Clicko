# ADR-0034 — Videography pricing: the owner's rate card

**Status:** Accepted 14 Nov 2026. The rate card is the owner's (Darshil, 14 Nov 2026); the
interpretations in D2–D5 were taken on the owner's behalf and are **overridable** — each one is a
ruleset row or a catalogue column, changed through the pricing editor or a seed, never in engine code.
**Amends:** ADR-0032 (VIDEOGRAPHER priced per tier, open to every tier; reels and raw footage added).
**Sources:** doc 05 §3 step 10, §5, §11; DOMAIN invariants 6, 17, 18; OD-01 (GST-exclusive);
ADR-0023; ADR-0026 (draft → publish); T&C §4.3–§4.4. Numbered 0034 because 0032 and 0033 were taken.

## The rate card (GST-exclusive, OD-01)

| Owner's line | Price |
|---|---|
| Videography per hour, Basic | ₹2,000 |
| Videography per hour, Advanced | ₹3,000 |
| Videography per hour, Professional | ₹5,000 |
| Reels | ₹3,000 per reel; ₹2,000 per reel when 5 or more are ordered |
| Raw footage (unedited files) | ₹1,000 extra |

## D1 — How video was modelled before, and after
- **Before (ADR-0032):** one add-on, `VIDEOGRAPHER`, ₹2,000/hr flat, Semi-Pro and up, no reels, no
  raw-footage line.
- **After:** three add-ons in ruleset **2026.11.14**.
  - `VIDEOGRAPHER`: per hour, one `addon_prices` row per tier, `city_tier` NULL (one rate in every city).
  - `REELS`: a counted add-on (quantity = number of reels), two quantity-break rows.
  - `RAW_FOOTAGE`: flat, once per booking.
- Video stays an add-on to a photo booking (ADR-0032 D3). A video-only booking still needs its own ADR.

## D2 — Tiers (interpretation)
The photo tiers are BASIC, SEMI_PRO, PROFESSIONAL, EXPERT, SIGNATURE. There is no "Advanced", so:

| Owner's tier | Engine tier | ₹/hr | Why |
|---|---|---|---|
| Basic | BASIC | 2,000 | same name |
| Advanced | SEMI_PRO | 3,000 | the tier between Basic and Professional |
| Professional | PROFESSIONAL | 5,000 | same name |
| (none) | EXPERT | 5,000 | above Professional; takes the top video rate rather than refusing video |
| (none) | SIGNATURE | quoted | quote-only, as for photos |

The video tier is the booking's tier: there is no separate video-tier picker. `VIDEOGRAPHER.min_tier`
moves from SEMI_PRO to BASIC. The catalogue is not versioned, so ruleset 2026.10.01 now also prices
a Basic videographer, at its flat ₹2,000/hr row, which equals the new Basic rate.

## D3 — Hours (interpretation)
Video hours are the booking's hours. The minimum and increments are the photo rules: at least 2 h, in
30-minute steps (`plan_deliverables.min_hours`, the `Hours` contract). Amount = `round(rate × hours)`,
once per line, integer paise, as for SECOND_SHOOTER.

## D4 — Reels (interpretation)
- 1–4 reels: ₹3,000 each. 5 or more: ₹2,000 each **for all of them**, not only the extras.
  4 reels = ₹12,000; 5 reels = ₹10,000.
- At most 20 reels per booking (`addons.max_quantity`).
- Reels need the videographer on the same booking (`addons.requires_addon_id`).

## D5 — Raw footage (interpretation)
₹1,000 flat per booking, not per hour; quantity 1 only. Needs the videographer.

## D6 — The engine capability: quantity-tier prices (addendum / migration 0021)
- `addon_prices.min_quantity` (default 1). The engine first takes the most specific scope that prices
  the requested quantity, (tier, city tier) → (tier, ∅) → (∅, ∅), as in doc 05 step 10. Inside that
  scope it picks the row with the highest `min_quantity` ≤ quantity, and that unit price applies to
  every unit. One multiplication and one half-up rounding per line, in integer paise.
- `addons.max_quantity` (default 4, the old contract cap): a larger quantity is rejected with
  `INVALID_ADDON_QUANTITY`. `addons.requires_addon_id`: a missing parent is rejected with
  `ADDON_REQUIRES_ADDON`. The same code twice is rejected with `DUPLICATE_ADDON` in the engine
  itself, so a quote can never split reels to dodge the cap or the 5+ rate. Rejections follow
  request order. The contract's quantity ceiling rises from 4 to 20, as input sanity only.
- The editor refuses to publish a quantity break dearer per unit than a lower one
  (`QUANTITY_BREAK_RISES`).
- None of the video lines takes a multiplier (invariant 6). GST applies to the whole taxable
  subtotal under SAC 998383, as for every line today. Expected payout is still the tier share of
  base + add-ons (doc 05 step 12), so reels and raw footage pay the photographer's share.

## D7 — Shipping: a new ruleset version, never an edit (invariant 17)
- `2026.11.14`, label "Videography rate card (ADR-0034)". The data lives in
  `engine/video-ruleset.ts`, the one source for the engine tests and the seed. The version names
  the card. It takes effect on 14 Nov 2026 00:00 IST, or when the seed runs if that is later: it
  is never backdated, the same rule as the editor's `EFFECTIVE_FROM_PAST`.
- `seedVideoRuleset` (run by `pnpm db:seed`, `pnpm db:seed:dev` and the e2e app) publishes it the
  way the editor publishes:
  - It builds a draft holding every child row of the ruleset in force (`copyChildren`), so a photo
    rate staff published since launch is kept.
  - It replaces the video codes' price rows in the draft only.
  - It closes the source at the start and publishes the draft with `based_on_id`.
  - It writes `pricing.ruleset_published` to the outbox and a SYSTEM `pricing.publish` audit row,
    in the same transaction.
  - Catalogue changes are insert-only. VIDEOGRAPHER opens to Basic only while it still has
    ADR-0032's Semi-Pro, so an ops edit is never overwritten.
  - It is idempotent. If a ruleset already starts at or after that time, it touches nothing
    (`SUPERSEDED`); the card then goes in through the editor.
- A draft opened before the seed ran and published afterwards would bring back the old video rows.
  The editor already warns that such a draft is stale; discard it.
- Bookings priced on 2026.10.01 keep that ruleset and its prices for life.

## Consequences and open items for the owner
- **Deliverables conflict (needs the owner):** T&C §4.3 says video "where included, is delivered as
  unedited camera-original recordings", and ADR-0032 delivered those clips with the videographer.
  The card now charges ₹1,000 extra for them. Decide one of these: (a) the unedited clips come with
  every videographer and the ₹1,000 buys something else; or (b) a videographer booking with neither
  reels nor raw footage delivers nothing, in which case one of them should be required, and T&C
  §4.3 needs a revision (the spec is read-only here).
- **Reels are editing.** T&C §4.4 needs edited work sold "with its own pricing and delivery
  timeline". There is no reel turnaround, editor workflow or reel delivery pipeline yet.
- Expert at ₹5,000/hr (D2), the 20-reel cap (D4) and the photographer's share on reels and raw
  footage (D6) are interpretations. The SAC for reel editing (998383 versus a post-production code)
  is for the accountant.
- The website still says video starts at Semi-Pro (`apps/web/src/content/rate-card.ts`, pinned to
  ADR-0032). The ₹2,000/hr "from" price is still true. Update the copy once the deliverables are
  settled.
- The admin calculator previews every add-on at quantity 1, so it shows the single-reel price.
