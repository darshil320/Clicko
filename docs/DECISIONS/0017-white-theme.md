# ADR-0017 — A white theme for the customer-facing surfaces

**Status:** Accepted 24 Oct 2026, at the owner's direction ("clean, simple, lively, with whitespace;
the theme should be white; keep the amber accent").
**Supersedes, for these surfaces:** `clickco-01-design-pipeline.md` §4 "Theme: dark-first" (as
extracted into docs/DESIGN.md). The spec is read-only and is not edited (SA-22 asks for v2).

## Decision
- **Surfaces.** The client app (Expo), the marketing website (apps/web) and the upload portal
  (apps/portal) move to a white theme. The ops console stays dark (internal tool; S9 rebuilds it on
  shadcn anyway).
- **Tokens.** `colorLight` (docs/DESIGN-LIGHT.md) has exactly the dark palette's token names, so
  every component keeps its semantic classes and a surface switches by switching palette.
  - Web: `cssVariables(colorLight)`.
  - Client: `lightTailwindPreset`.
  - Tests check every value against DESIGN-LIGHT.md, and WCAG contrast: all text tokens ≥ 4.5:1 on
    page and card; status colours ≥ 4.5:1 as text.
- **Amber stays the brand.** `#FFB63D` is a fill with dark `text/on-accent` (≥ 7:1). It is never
  body text on white (1.8:1). Links and emphasis use text/primary.
- **New light-only tokens:**
  - `elevation` (soft shadows; dark keeps layering);
  - `sectionSpace` (web vertical rhythm 120 / 80 / 48, content 1120, reading 680);
  - `motion` (160 / 240 / 600 ms, one ease-out curve; reduced-motion always honoured).
- **Whitespace and life:**
  - More air between groups: mobile 24, web sections 120 on desktop.
  - Calm cards on a warm off-white band.
  - Small, purposeful motion: fade-and-rise reveals, a gently moving city marquee, hover lift.
  - Patterns are taken from the Magic UI registry (marquee, bento grid, blur fade, dot pattern) and
    rebuilt in token CSS. No new dependencies: the web apps have no Tailwind or motion library, and
    adding one needs owner approval (CLAUDE.md).
- **21st.dev's MCP** was requested but is not connected in this session. Its components can be
  folded in later through the same tokens.

## Consequences
- DESIGN.md (dark) remains the console's source; DESIGN-LIGHT.md is the customer surfaces'.
- Figma Wave 1 (still pending) should be drawn in the white theme. SA-06's mockup fixes apply
  unchanged.
