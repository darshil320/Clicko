# ADR-0032 — Video is priced as a videographer add-on

**Status:** Accepted 14 Nov 2026, owner decision (Darshil). **Amended by ADR-0034** (per-tier
video rates from ruleset 2026.11.14, every tier eligible, reels and raw footage).
**Resolves:** the video-rate half of OD-11 that ADR-0023 left open ("video rates still to be set
in the pricing engine"). **Amends:** ADR-0023 (bookings can be Photos or Photos + video; Video
alone is deferred). **Sources:** doc 05 §3 Step 10 and §5 `addon_prices`; T&C §4.3; DOMAIN
invariants 6 and 17; ADR-0012 D1 (the development realignment pattern).

## Context
The website sold video ("Video is priced in the app at launch", footer "Photo and video") while
the client app said "Video — photos only at launch" and no ruleset carried a video rate. A client
could read the site, open the app and find nothing to buy: a misleading-advertising risk under the
Consumer Protection Act 2019.

## D1 — Video ships as the VIDEOGRAPHER add-on
A second person shoots video alongside the photographer, for the booking's hours.

| Addon | Price | Per hour | Min tier | Notes |
|---|---|---|---|---|
| VIDEOGRAPHER | ₹2,000/hr | ✅ | SEMI_PRO | stored share 62%; payout follows the tier share (D1) |

- 200000 paise per hour, priced exactly like SECOND_SHOOTER: `round(amount × hours)`, once per
  line, integer paise.
- Not multiplied by category uplift, emergency, festival surge, night or weekend (doc 05 Step 10,
  DOMAIN invariant 6).
- Below Semi-Pro the engine rejects it with `ADDON_TIER_INELIGIBLE`, as it does SECOND_SHOOTER.
- `addon_prices.payout_share_bps` is 6200, recorded like SECOND_SHOOTER's. The engine's expected
  payout applies the tier's base-rate share to base + add-ons (doc 05 Step 12), so the photographer
  is paid on the videographer line at the tier share, exactly as for a second shooter.
- No drone credentials, no airspace check, no dispatch filter. Like SECOND_SHOOTER, the assigned
  photographer brings the second person; the videographer vetting and gear rubric stays an ops
  item (ADR-0023 Consequences).

## D2 — What video delivers (T&C §4.3, unchanged)
- Unedited, camera-original clips in the camera's standard compressed format, by secure link.
- No edited reel, no cutting or assembly. Editing is a separate paid service.
- No video turnaround beyond the booking's own delivery promise. No tier includes video, so
  `plan_deliverables.video_included` stays false for every tier.

## D3 — "Photos + video" now; "Video only" later
- The client app sells the add-on from Semi-Pro up, with its price shown in the add-on list and as
  its own `ADDON_VIDEOGRAPHER` quote line before payment.
- The website says video is booked as a videographer add-on from ₹2,000/hr, priced in the app
  before you pay. Its picker offers Photos and Photos + video; it no longer offers Video alone.
- A video-only booking (no photographer) needs its own ADR: its own base rate, dispatch to
  videographers, and a delivery pipeline sized for video storage.

## D4 — Where the rate lives
- `ADDON_CATALOGUE` in `apps/api/src/modules/pricing/engine/launch-ruleset.ts`, so the engine tests
  and the seed read one fixture. Placed last, so a database seeded earlier keeps its sort orders.
- No schema change: `addons.code` is free text (no enum, no check constraint). No migration, no
  addendum.
- Ruleset 2026.10.01 gains the row in place. Production has no ruleset rows yet, so nothing priced
  against it moves (invariant 17). Development databases seeded earlier get it from
  `alignLaunchAddonPrices` in `pnpm db:seed:dev`: insert-only, idempotent, never changes a price.
  Once production holds a published ruleset, a rate change goes through the ruleset editor as a
  new version, never in place.
- `packages/contracts` `AddonCode` gains `VIDEOGRAPHER`. The admin calculator's add-on cap is now
  the number of add-on codes, so staff can still preview every add-on at once.

## Consequences
- doc 05 §5 is a read-only specification and does not list VIDEOGRAPHER; this ADR is the source
  for that row until doc 05 v2 absorbs it.
- **Before the first videographer booking:** turn on the `video_uploads` feature flag for each
  launch city. Until it is on, the upload API refuses video files (`VIDEO_UPLOADS_DISABLED`) and
  the portal filters them out, so booked clips could not be delivered.
- Still open for ops: the videographer vetting and gear rubric, and video storage planning against
  the Drive tripwire (v0.2 §3).
