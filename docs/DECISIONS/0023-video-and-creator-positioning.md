# ADR-0023 — Video is in scope; the website speaks to creators and everyday moments

**Status:** Accepted 26 Oct 2026, at the owner's direction ("very Gen Z-focused … people just shoot
reels … influencers as well as normal consumers … we are going to do both photos and videos").
**Resolves:** OD-11 (video at launch). ADR-0005 had defaulted it to photos only, pending this
confirmation. **Builds on:** ADR-0019 (shoot-picker hero). **Applies to:** `apps/web`.

## Decision
- **Video is offered.** The website sells photographers and videographers. Bookings can be Photos,
  Video, or Photos + video.
- **Video price: "priced in the app".** The rate card (doc 05) has photo rates only, so:
  - The site shows no video figure. The hero picker shows the exact photo price and says the video
    is priced in the app at launch.
  - Video rates belong in a pricing-engine ruleset (doc 05 v2), not in the website.
- **What video delivers (Terms §4.3, unchanged):**
  - Unedited, camera-original clips by secure link.
  - Editing, including cut-down vertical reels, is a separate paid edit, like Clickco Edit for
    photos.
  - The site never promises an edited reel or a video turnaround time.
- **Positioning.** The home page leads with everyday and creator moments, each mapped to a real
  category, tier and hour count from the rate card, so every "from" price stays exact:
  - a new-city shoot
  - a surprise proposal
  - a creator content day
  - a birthday
  - a café or brand launch
  - convocation

  "Book this" pre-fills the hero picker.
- **Usage rights.** Creators are told that personal and commercial use is included (Terms §9.2).
  Stock and resale are excluded (§9.3).
- **Sample video.** Vertical reel loops are Pexels-licence clips, self-hosted (720×1280, about
  1 MB, no audio) and labelled as samples, as ADR-0019 does for photos. Loops play only while on
  screen and never under reduced motion.
- **Mobile "your shoot" bar.** On phones, once the picker scrolls away, a bottom bar keeps the
  current shoot and price in reach, like a cart.

## Consequences
- Copy that said "photography only" (FAQ, plan exclusions, footer) now describes video as above.
- Not done here (backend, owner and ops):
  - video rates in the pricing engine;
  - `plan_deliverables.video_included` per tier;
  - the videographer vetting and gear rubric;
  - storage planning for video (the Drive tripwire in v0.2 §3).
- Identifiable people in sample clips carry no model releases: keep them off paid ads.
