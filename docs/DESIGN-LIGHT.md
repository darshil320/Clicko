<!-- ADR-0017: the white theme for the client app, the marketing website and the upload portal.
     Source of truth for `colorLight`, `elevation`, `sectionSpace` and `motion` in packages/design-tokens
     (tokens.test.ts fails if they drift). docs/DESIGN.md (dark, from clickco-01 §4) stays as written. -->

# CLICKCO DESIGN SYSTEM — LIGHT

## Theme: white, airy, lively
Clean white canvas, generous whitespace, one warm amber accent. The photos stay the
hero: the UI is quiet, type is confident, and motion is small and purposeful.
Same token names as the dark theme, so a surface switches theme by switching palette.

## Colour
surface/base          #FFFFFF   page and app background
surface/raised        #FAFAF8   cards, section bands
surface/overlay       #FFFFFF   modals, sheets, dropdowns (with elevation)
border/subtle         #ECECE7   dividers, card edges
border/strong         #D6D6CF   inputs, focus rings

text/primary          #0E0E10
text/secondary        #52525B
text/tertiary         #71717A
text/on-accent        #1A1206

accent/default        #FFB63D   primary actions, brand   (warm amber — fills only, never text on white)
accent/hover          #F5A524
accent/subtle         #FFF5E1   accent-tinted backgrounds

emergency/default     #C8262D   Emergency tier ONLY
emergency/subtle      #FFF1F1

success               #15803D   delivered, paid, completed
warning               #B45309   SLA at risk, action needed
danger                #DC2626   failures, cancellations

## Elevation
Light allows soft, low-contrast shadows (dark uses layering instead).
sm   0 1px 2px rgba(14,14,16,0.04)                         inputs, chips
md   0 2px 8px rgba(14,14,16,0.04), 0 8px 24px rgba(14,14,16,0.06)   cards on hover, sheets
lg   0 24px 64px rgba(14,14,16,0.10)                       modals, the hero device frame

## Whitespace
Web sections breathe: vertical rhythm between sections is 120 (desktop) / 80 (tablet) / 48 (mobile).
Content max width 1120; reading width 680. Cards keep 16–24 internal padding; gaps 16–24.
Mobile screens keep 20 side padding and 24 between groups (one step up from dark's 12).

## Motion
Subtle and quick: 160 ms for hover/press, 240 ms for reveals, 600 ms for the hero entrance;
ease-out cubic-bezier(0.22, 1, 0.36, 1). Reveal = fade + 8px rise + light blur.
Always honour prefers-reduced-motion: no movement, instant state.

## Rules carried over from DESIGN.md
Typography, spacing scale, radius, components, content rules and accessibility are unchanged.
Body text ≥ 4.5:1 against its surface; the amber accent is a fill (with text/on-accent), never
body text on white. Never more than one accent-coloured element in the viewport at a time.
