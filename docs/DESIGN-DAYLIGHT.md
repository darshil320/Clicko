<!-- ADR-0018: the marketing brand layer for apps/web only. Source of truth for `colorDaylight`,
     `daylightExtras`, `daylightType`, `daylightRadius` and `daylightElevation` in
     packages/design-tokens (tokens.test.ts fails if they drift). DESIGN-LIGHT.md stays the source for
     the client app and the upload portal. -->

# CLICKCO DESIGN SYSTEM — DAYLIGHT (marketing website)

## Theme: a gallery that takes bookings
Warm paper, editorial serif headlines, generous air, and photographs doing the talking. One
golden-hour accent. Honest numbers shown big. Same token names as DESIGN-LIGHT, so the website
switches by switching palette.

## Colour — the palette (same names as DESIGN-LIGHT)
surface/base          #FBFAF7   page ground (warm paper)
surface/raised        #F3EFE7   section bands, inset wells (linen)
surface/overlay       #FFFFFF   cards, the floating nav, quote and status cards
border/subtle         #E8E3D9   hairlines, card edges
border/strong         #D3CCBF   ghost buttons, inputs

text/primary          #141210   headlines and body
text/secondary        #4B4640   leads, card copy, nav links
text/tertiary         #6E675D   captions on paper, linen, white and accent/subtle only
text/on-accent        #1A1206

accent/default        #FFB63D   golden hour — fills only
accent/hover          #F5A524
accent/subtle         #FFF1D6   recommended tier, the live chip

emergency/default     #C8262D   Emergency tier ONLY
emergency/subtle      #FFF1F1

success               #15803D
warning               #B45309
danger                #DC2626

## Colour — extras (website only)
accent/text           #8A5000   amber as text: links, the italic accent word
sage/default          #DCE5D6   tint for verification and trust
sage/deep             #3A5535   text and icons on sage
clay/default          #F3DED3   tint for people and the shoot
clay/deep             #934328   text and icons on clay
haze/default          #DDE6EE   tint for delivery and files
haze/deep             #2C5170   text and icons on haze
darkroom/default      #121110   the one dark band per page, and the footer
darkroom/text         #F6F2EA   headlines and body on darkroom
darkroom/muted        #A39C90   captions on darkroom

## Colour — placeholder photographs only (never UI)
photo/sun             #FFC56B
photo/ember           #D9703A
photo/rose            #E6B3A1
photo/leaf            #7E9A6E
photo/sea             #7FA3BF
photo/cream           #F6EBD9
photo/dusk            #3B3330

## Type (ADR-0020)
display   Plus Jakarta Sans 700 — headlines, prices, big numerals. Tracking -0.035em.
body      Plus Jakarta Sans 400–600 — all UI and running text.
accent    Instrument Serif italic — only the one accent phrase in a headline, 1.08× its size.
labels    Plus Jakarta Sans 600, uppercase, 0.1em tracking — eyebrows, chips, photo captions.
Fluid web steps, phone → 1120 wide:
hero      40 → 76   leading 1.0
page      36 → 60   leading 1.04
section   32 → 52   leading 1.06
figure    28 → 40   leading 1.1
All families are OFL and self-hosted. Indic scripts fall back to Noto Sans Devanagari / Gujarati.

## Shape and depth
radius/photo   28   photo frames, bento tiles, city cards
radius/panel   40   full-width panels (darkroom band, closing call to action, footer)
Cards keep DESIGN radius/lg 16. Buttons, chips and the nav are full pills.
shadow/photo   0 40px 80px -32px rgba(20,18,16,0.35)   photos floating in the hero collage

## Rules
- Photos are the hero: every section carries a photo frame; never set body copy on a photo.
- One accent-filled element per viewport. Amber is a fill with text/on-accent; amber as text is
  accent/text. The one exception: on darkroom, the italic accent word is amber itself (≥ 7:1).
- Text colours sit only on the grounds named above. On sage, clay and haze use text/primary,
  text/secondary or the tint's own deep colour — never text/tertiary.
- One linen band, one darkroom band and one amber panel per page, never two of a kind in a row.
- Motion, spacing, section rhythm and accessibility rules are DESIGN-LIGHT's, unchanged.
