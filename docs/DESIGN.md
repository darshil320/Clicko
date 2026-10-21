<!-- Extracted verbatim from docs/clickco-01-design-pipeline.md §4. Source of truth for packages/design-tokens. -->

# CLICKCO DESIGN SYSTEM

## Brand
On-demand professional photography, India. Premium but approachable.
Not a luxury boutique. Not a discount aggregator.
Feeling: confident, fast, trustworthy. The photos are the hero; the UI recedes.

## Theme: dark-first
Photography products look better on dark. Dark also differentiates us from every
light-mode Indian services app (Urban Company, Swiggy, Zomato) and reads premium
at no extra cost.

## Colour
surface/base          #0A0A0B   app background
surface/raised        #141416   cards, sheets
surface/overlay       #1C1C1F   modals, dropdowns
border/subtle         #26262A   dividers, card edges
border/strong         #3A3A40   inputs, focus rings

text/primary          #FAFAFA
text/secondary        #A1A1AA
text/tertiary         #71717A
text/on-accent        #1A1206

accent/default        #FFB63D   primary actions, brand   (warm amber)
accent/hover          #FFC55C
accent/subtle         #2A1F0A   accent-tinted backgrounds

emergency/default     #FF4D4F   Emergency tier ONLY — never a generic error red
emergency/subtle      #2A1214

success               #22C55E   delivered, paid, completed
warning               #F59E0B   SLA at risk, action needed
danger                #EF4444   failures, cancellations

## Typography
Display / headings:  Inter Tight  — 600/700
Body / UI:           Inter        — 400/500/600
Numerals:            Inter, tabular-nums for all prices and timers
Indic fallback:      Noto Sans Devanagari, Noto Sans Gujarati

Scale (mobile):
display   32/38  700
h1        24/30  700
h2        20/26  600
h3        17/24  600
body      15/22  400
bodyStrong 15/22 600
caption   13/18  400
micro     11/14  500  uppercase, 0.06em tracking

## Spacing — 4pt base
4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56
Screen horizontal padding: 20
Card internal padding: 16
Gap between stacked cards: 12

## Radius
sm 8 · md 12 (default) · lg 16 (cards, sheets) · full 999 (pills, avatars)

## Elevation
No drop shadows on dark. Depth comes from surface layering
(base → raised → overlay) plus a 1px border/subtle.

## Components
Button primary   accent/default bg, text/on-accent, radius md, height 52, weight 600
Button secondary surface/raised bg, 1px border/strong, text/primary
Button ghost     transparent, text/secondary
Input            surface/raised bg, 1px border/strong, radius md, height 52
Card             surface/raised, 1px border/subtle, radius lg, padding 16
Chip / filter    pill, surface/raised, active = accent/subtle bg + accent text
Bottom sheet     surface/overlay, radius lg top corners, 44px drag handle
Status badge     pill, micro type, tinted bg + matching text colour
Plan tier badge  micro type, letter-spaced, tier-coloured

## Layout rules
- Single-column mobile. No side-by-side cards under 400pt.
- Primary CTA pinned to bottom with safe-area inset, above a 16px gap.
- Photography imagery: full-bleed edge to edge, no rounded corners on hero images.
- Never more than one accent-coloured element in the viewport at a time.
- Empty states always include an illustration slot and one action.

## Iconography
Lucide, 20px default, 1.5px stroke, text/secondary unless active.

## Content rules — IMPORTANT
- Currency is ₹ (INR). Format Indian: ₹6,000 / ₹1,20,000 (lakh grouping).
- Real Indian names in mockups: Priya Sharma, Rahul Mehta, Aisha Khan,
  Vikram Reddy, Ananya Iyer.
- Real Indian cities: Surat, Mumbai, Vadodara, Ahmedabad, Pune.
- Never use lorem ipsum. Never use dollar signs. Never use Western stock names.
- Dates: DD MMM (14 Sep). Times: 12-hour with am/pm (4:30 pm).
- Phone: +91 followed by 10 digits.

## Accessibility
Body text minimum 4.5:1 against its surface. Tap targets minimum 44×44.
Never encode meaning in colour alone — always pair with an icon or label.
