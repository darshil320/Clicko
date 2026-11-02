# ADR-0028 — Daylight: plain section heads, one accent phrase, each fact once

**Status:** Accepted 2 Nov 2026, at the owner's direction ("go ahead with ADR-0028 direction",
"repeated facts appear once only"), after a Hallmark audit of apps/web.
**Amends:** ADR-0018 and ADR-0022 (labels, the accent phrase). **Applies to:** `apps/web` only.

## Context
The audit (`/hallmark audit apps/web`, sloplint plus screenshots at 390, 1280 x 800 and 1920)
found the product-led hero, the real photographs and the honest prices worth keeping, and one
formula repeated down the home page: a small tracked-capitals eyebrow, a two-line heading with an
amber second phrase, a lead on the right. Ten sections used it. Meta lines joined with middle
dots, arrows glued to link text, a dot before every tier name and icons in tinted tiles added to
the generated look, and the same proof (verified photographers, photos in 48 hours, 50% to book,
prices with GST) was printed in four or more sections. DESIGN-DAYLIGHT prescribed the eyebrow
and the accent phrase, so the fixes needed a decision rather than a polish.

## Decision
- **D1 — No eyebrows.** A section opens with its heading. Small type before a heading stays only
  when it carries a fact the heading does not (a breadcrumb, a live status).
- **D2 — Labels in sentence case.** Chips, photo captions, table heads, tier names and footer
  heads are Onest 600 at the caption step, sentence case, untracked. No uppercase, no tracking.
- **D3 — One accent phrase per page, in the home hero headline.** Section headings are one
  weight and one colour. The accent is never italic, on paper or on darkroom; the darkroom
  exception in DESIGN-DAYLIGHT §Rules goes.
- **D4 — Arrows and dots.** The arrow disc stays on the amber primary button only. No arrow is
  glued to link or button text. A dot marks live state only (the Live and Pilot chips); tier
  names lose theirs.
- **D5 — No middle-dot meta strings.** Lists of facts break onto lines or run as commas.
- **D6 — Each proof fact once per page,** where it does the most work:
  verified photographers → Why Clickco; photos in 48 hours as RAW + JPEG → How it works, step 4;
  50% to book → How it works, step 1; prices shown with GST → Pricing; clips unedited and
  camera-original → Clips for your feed; personal and commercial use → the creators band.
  The hero's proof list and the step-card chips go, since each repeated a fact owned elsewhere.
  Comparisons keep their rows (tier cards, the lead-time table), and FAQ answers, legal pages
  and each city or category page are exempt.
- **D7 — No icon tiles above headings.** A card's icon, if it keeps one, sits inline with text.

Not adopted from Hallmark: its ban on dashes in copy (better-typography wants correct em dashes,
and no Clickco document bans them) and its 6 to 9 section budget for the home page.

## Consequences
- DESIGN-DAYLIGHT §Type and §Rules are updated. `daylightType.trackingEm.label` becomes 0 and its
  token test follows, in the same change as the website.
- `Section` loses its `eyebrow` prop; headings drop their `<em>`. The hero keeps its accent
  phrase as a span, so no heading carries italic markup.
- Copy changes are limited to removing repeated facts; every changed line is listed in the
  commit that changes it.
