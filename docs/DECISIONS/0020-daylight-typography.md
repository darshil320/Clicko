# ADR-0020 — Daylight typography: one premium sans, a serif accent

**Status:** Accepted 25 Oct 2026, at the owner's direction ("more niche-specific and premium, like
Urban Company and other Indian unicorns").
**Amends:** ADR-0018 §Type. **Applies to:** `apps/web` only; the apps keep `typography` (Inter).

## Context
ADR-0018 set headlines in Instrument Serif, UI in Inter Tight and labels in Geist Mono. Three
families read editorial rather than product-premium, and the mono labels felt developer-ish. Indian
consumer brands in the same space (Urban Company, Swiggy, CRED) lead with a confident geometric
sans, typically a licensed or custom face; a serif, where used, is an accent.

## Decision
- **Plus Jakarta Sans** for everything: headlines at 700 with tight tracking, UI and body at
  400–600, labels at 600 uppercase. It is the closest open-licence (OFL) match to that geometric
  startup look, so no licence cost or new dependency; next/font self-hosts it at build time.
- **Instrument Serif italic** stays only for the one accent phrase per headline, in accent/text,
  at 1.08× to match the sans x-height.
- Inter Tight and Geist Mono leave the website. Fluid steps shrink for a bold sans
  (hero 40 → 76, section 32 → 52).

## Consequences
- DESIGN-DAYLIGHT §Type is updated; token tests check it.
- If the brand later licenses Gilroy or commissions a face, only `daylightType.family` and
  `app/fonts.ts` change.
