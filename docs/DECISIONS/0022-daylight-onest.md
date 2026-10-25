# ADR-0022 — Daylight typography: Onest

**Status:** Accepted 25 Oct 2026, at the owner's direction (picked Onest from live specimens of
current startup typefaces: "Switch the website to Onest for headlines and text").
**Supersedes:** ADR-0021. **Applies to:** `apps/web` only; the apps keep `typography` (Inter).

## Decision
- **Onest** for everything: headlines and prices at 700 tracked tight (-0.04em), the accent phrase
  at 500 in accent/text, UI and body at 400–600, labels at 600 uppercase.
- One family: the modern-startup look of 2025–26 is a single neo-grotesk set large and tight,
  with personality from weight and colour rather than a second face. Onest is friendly and
  app-like, close to Indian consumer apps, and very legible at small sizes.
- OFL, self-hosted through next/font at build time. Outfit and Figtree leave.

## Consequences
- DESIGN-DAYLIGHT §Type is updated; token tests check it.
- A licensed or custom face later changes only `daylightType.family` and `apps/web/app/fonts.ts`.
