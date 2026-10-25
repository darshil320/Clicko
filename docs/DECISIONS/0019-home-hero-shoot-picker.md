# ADR-0019 — Home hero: the shoot picker, and licensed sample photography

**Status:** Accepted 25 Oct 2026, at the owner's direction ("it's a bit of an all-sort-of AI template
… make it different … take inspiration from Urban Company"). The owner chose the shoot picker over a
sentence builder, licensed stock photos until Clickco has its own, and the hero first, then the
rest of the home page.
**Builds on:** ADR-0018 (Daylight). **Applies to:** `apps/web`, the home page.

## Context
The ADR-0018 hero stacked the patterns that generated sites share: a chip with a pulsing dot, a
photo pill inside the headline, a three-frame collage, floating "Photographer assigned" cards,
camera-spec captions and soft radial glows. The frames were gradients painted to look like
photographs, which is the strongest tell of all on a photography brand.

References: Urban Company leads with a short headline and makes the hero the product — a service
picker, then proof, then photos of real work. Snappr, the closest analogue (photographers on
demand), lets real photographs carry the page.

## Decision
- **The hero is the product.** The headline runs across the page; under it, a shoot picker sits
  beside a photo:
  - Seven category tiles (radios), the city, hours (2–8) and the tier.
  - The total with GST updates as you choose. It comes from the rate card through `quoteFor`
    (`src/lib/pricing.ts`), with the same "from" conditions as every other price on the site:
    weekday daytime, booked 2+ days ahead, no add-ons or travel. The app's quote stays
    authoritative.
  - The tier we recommend for the chosen category is marked, not forced.
  - Calls to action: the waitlist, and the chosen city × category page.
  - The photo follows the category.
- **Removed from the home hero:** the live-dot chip, the photo pill in the headline, the collage,
  the floating status cards, camera captions and the glow. The hero sits on flat paper.
- **The picker stops at 8 hours.** It is a marketing estimate; longer shoots are quoted in the app.
- **Two new site primitives:** a segmented radio (`.seg`) and a stepper (`.stepper`) in
  `styles/components.ts`. `packages/ui` is React Native and `packages/ui-web` is an empty
  placeholder, so apps/web keeps its own primitives, as it already does for the price tabs and the
  waitlist form.
- **Sample photography.** Until Clickco's own shoots exist, the site's photo frames use licensed
  stock:
  - Licence: the Unsplash License or the Pexels License only; never Unsplash+ and never
    "editorial use only".
  - Hosting: self-hosted under `public/photos`, resized to 1600 px and stripped of metadata.
  - Labelling: the footer says every photo is a licensed sample; the hero, page heroes and the app
    panel caption theirs "sample photo"; credits live in `src/content/photos.ts`. A caption never
    names a city the photo was not taken in.
  - Replacement: Clickco's own photographs replace them one file at a time.
- **The rest of the home page** loses the same patterns: the scrolling category marquee (the
  picker now does its job), camera-spec captions, corner marks, inline photo pills, and the glows
  behind page heroes and the darkroom band. Frames in the steps, categories, cities and app panel,
  and on the city and category pages, take the sample photos.

## Consequences
- DESIGN-DAYLIGHT's "every section carries a photo frame" still holds; frames now hold photographs.
- Stock licences allow commercial use but do not guarantee model releases. Sample photos stay off
  paid ads and print, and are the first thing to replace once Clickco shoots its own work.
- No new dependency.
