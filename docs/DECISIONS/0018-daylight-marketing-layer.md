# ADR-0018 — Daylight, the marketing brand layer

**Status:** Accepted 24 Oct 2026, at the owner's direction ("a modern, premium, image-led redesign of
the marketing side, playing with whites and light colours").
**Builds on:** ADR-0017 (white theme). **Applies to:** `apps/web` only. The client app and the upload
portal stay on `colorLight`; the console stays dark.

## Context
ADR-0017 made the website white, airy and amber-accented, but it reads like a product UI: one sans
family, white cards, icon chips. The owner wants the marketing site to feel like a photography
brand — editorial, warm and led by imagery — without touching the apps that share `colorLight`.

## Decision
- **A separate palette, same names.** `colorDaylight` in `@clickco/design-tokens` has exactly
  `colorLight`'s token names, so every existing web style keeps its semantic variable and the site
  switches by switching palette:
  - `surface/base` is warm paper `#FBFAF7`, not white; `surface/overlay` (white) carries cards;
    `surface/raised` is linen `#F3EFE7`, for section bands.
  - Text and borders warm up to match the paper. Amber, emergency and status colours are unchanged.
- **Daylight extras** (`daylightExtras`), all marketing-only:
  - `accent/text` `#8A5000` — amber as text, for links and the italic accent word in headlines.
    This replaces ADR-0017's "links use text/primary" on the website only. Plain amber
    `#FFB63D` is still never text.
  - Three tints with a text colour each: sage (verification), clay (people, the shoot), haze
    (delivery, files).
  - `darkroom` — the one dark band per page (Emergency) and the footer.
  - `photo/*` — seven colours used only to paint placeholder photographs until real ones exist.
- **Type.** Display moves to Instrument Serif (headlines, prices, big numerals). Inter Tight stays
  for text, and Geist Mono is added for small uppercase labels and camera captions. All three are
  OFL and self-hosted at build time through `next/font/google`, which ships with Next: no new
  dependency, and visitors' browsers make no request to Google.
- **Shape and depth.** Photo frames get `radius/photo` 28 and full-width panels `radius/panel` 40;
  one new shadow, `photo`, lifts frames in the hero collage. The 4pt spacing scale, motion tokens
  and section rhythm are unchanged.
- **Imagery.** Every section carries at least one photo frame. Until real photography exists,
  frames show a placeholder mood painted from `photo/*` and a caption naming what goes there.
- **Light only.** The design system also defines a dark "Darkroom" theme; the website does not
  ship it (`color-scheme: light`, as today).
- **Source of truth.** `docs/DESIGN-DAYLIGHT.md`. Tests check every value against it, plus WCAG
  contrast for each text colour on each ground it is allowed on. The published design system
  (Clickco Daylight artifact) is the visual reference.

## Consequences
- `DESIGN-LIGHT.md` stays the source for the client app and the portal.
- Section components are restyled; the content, prices (from the rate card, in paise), the
  lead-time table, the waitlist form and every legal link stay exactly as they are.
- When real photography arrives, frames take a `src`; no layout change.
