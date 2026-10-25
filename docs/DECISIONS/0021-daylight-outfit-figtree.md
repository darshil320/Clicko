# ADR-0021 — Daylight typography: Outfit and Figtree

**Status:** Superseded by ADR-0022 (25 Oct 2026). Accepted 25 Oct 2026, at the owner's direction (picked pairing D from five live
specimens: "Outfit for headlines and prices, Figtree for text, but modern").
**Supersedes:** ADR-0020. **Applies to:** `apps/web` only; the apps keep `typography` (Inter).

## Decision
- **Outfit 600** for headlines, prices and big numerals, tracked tight (-0.04em). A clean
  geometric display face in the family of consumer apps like Urban Company and Swiggy.
- **Figtree** 400–600 for UI and running text; labels at 600 uppercase, 0.08em.
- **No serif.** The accent phrase in a headline is Outfit at 400 in accent/text: the contrast
  comes from weight and colour, not a second style. Instrument Serif and Plus Jakarta Sans leave.
- Both are OFL, self-hosted through next/font at build time. No new dependency, no licence cost.

## Consequences
- DESIGN-DAYLIGHT §Type is updated; token tests check it.
- A licensed or custom face later changes only `daylightType.family` and `apps/web/app/fonts.ts`.
