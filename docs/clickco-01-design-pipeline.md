# CLICKCO — DESIGN PIPELINE
**Which tool, in what order, with the exact prompts**
Doc 1 of 3 · 27 Aug 2026

---

## 1. The finding that decides everything

You asked: Stitch, or Claude Code Design, or something else. The answer depends on a constraint most guides skip.

| Tool | Exports to | React Native? |
|---|---|---|
| **Google Stitch** | HTML/CSS, Tailwind, Vue, Angular, Flutter, SwiftUI, **Figma** | ❌ No |
| **v0 (Vercel)** | React / Next.js | ❌ No |
| **Figma Make** | React / web | ❌ No |
| **Lovable / Bolt** | React web full-stack | ❌ No |
| **Claude Code + Figma MCP** | Anything, including RN | ✅ **Yes** |

Your mobile apps are Expo/React Native. **Nothing generates React Native from a prompt at production quality.** So the code-export button on any of these tools is a dead end for the two apps that matter most.

**But there is a clean bridge.** Stitch exports Tailwind classes. NativeWind lets React Native consume Tailwind classes. And the Figma MCP server gives Claude Code direct read access to your frames — layout, variables, spacing, auto-layout — so it writes RN code against the real design rather than guessing from a screenshot.

So the pipeline is:

```
Stitch (visual exploration, fast, free)
   ↓ Paste to Figma
Figma (single source of truth, design tokens as Variables)
   ↓ Figma MCP
Claude Code (writes React Native + NativeWind)
   ↓ screenshot → paste back → refine
Verified component
```

Stitch is for *deciding what it looks like.* Claude Code is for *building it.* Don't ask either one to do the other's job.

---

## 2. Tool per surface

| Surface | Design tool | Build tool | Why |
|---|---|---|---|
| **Client app** (RN) | Stitch → Figma | Claude Code + Figma MCP + NativeWind | No RN export exists anywhere; MCP path is the only production route |
| **Pro app** (RN) | Reuse client design system, Stitch for the 6 novel screens | Same | 70% of components are shared — design once |
| **Admin panel** (web) | **Skip design entirely** | Claude Code + shadcn/ui | Internal tool. shadcn *is* the design. Designing an admin panel in Stitch is wasted effort — you'd be redrawing components that already exist. |
| **Marketing site** (web) | **v0** or Stitch | v0 output → Next.js, or Framer directly | Web output is native to these tools, so code export actually works here |
| **Web upload portal** | Skip design | Claude Code + shadcn | Four screens, one job, used by photographers not customers |

**The single biggest time saving on this list is not designing the admin panel.** shadcn/ui gives you a coherent, accessible, professional component set for free. Spending two weeks in Figma on internal CRUD screens is the most common way agencies burn budget on projects like this.

---

## 3. Why route through Figma instead of straight from Stitch

Reasonable question — Stitch has a code export, why add a step?

Three reasons, and they compound over a 50-screen product:

1. **Single source of truth.** With 50 screens across two apps, you need one file where the design system lives. Stitch generations are individual artifacts; Figma is a system. When you change your accent colour in month four, you change one Variable, not 50 exports.
2. **Code Connect.** Figma's Code Connect maps a Figma component to the real component in your repo, so Claude reuses `<Button variant="primary">` instead of rebuilding a nested stack of Views every single time. This is the difference between a codebase and 50 disconnected screens.
3. **Design tokens, not pixels.** Over MCP, Claude reads your Figma *Variables* — `color/accent/default`, `space/4` — and writes code referencing tokens. Without it, you get hardcoded `#FFB63D` in 40 files.

The Figma step costs you roughly a day of setup and saves that back in the first week of building.

> Note: Figma MCP shipped bidirectional support with Claude Code in Feb 2026 — Claude can also push a UI it built *back* to the canvas as editable layers. Useful for the admin panel: build in shadcn, push to Figma if you ever need to show a client.

---

## 4. Stage 0 — Lock the design system first (do this before any screen)

Stitch supports **DESIGN.md**, a portable design-system rules file. Every guide that reports good Stitch results says the same thing: create DESIGN.md *before* generating screens, or every generation drifts.

Here is Clickco's, ready to paste.

```markdown
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
```

Paste this into Stitch as your project's DESIGN.md before generating anything. Then also commit it to `/docs/DESIGN.md` in the repo, because Claude Code will read it too.

---

## 5. Stage 1 — Stitch screen prompts

Stitch is free through Google Labs on a credit system (roughly 350 standard and 200 experimental generations a month), generates up to 5 interconnected screens at once, and has an infinite canvas that keeps every iteration side by side. Mobile output is stronger than web output.

### The prompt structure that works

Vague prompt in, generic design out. Five parts, every time:

```
1. ROLE + SYSTEM   → who you are, adhere to DESIGN.md
2. SCREEN          → the one job this screen does
3. USER STATE      → what's already true when they arrive
4. CONTENT         → the exact elements, top to bottom, with real copy
5. CONSTRAINTS     → what not to do
```

### Prompt 1 — Client app, booking core (5 screens)

```
You are designing for Clickco, an on-demand professional photography booking
app for India. Follow the project DESIGN.md exactly: dark-first, amber accent,
Inter, 4pt spacing, ₹ pricing, real Indian names.

Generate 5 connected mobile screens for the booking flow.

SCREEN 1 — Home / Browse
User state: logged in, location = Surat, has booked once before.
Content top to bottom:
- Compact header: Clickco wordmark left, location pill "Surat" with chevron,
  notification bell with a dot
- Search field, placeholder "Food, wedding, portrait…"
- Emergency banner card: "Need a photographer today?" with an emergency-red
  accent left border, subtitle "Book in the next 3 hours", chevron
- Section "Browse by need" — horizontal scroll of 6 category cards, each a
  square photo with the label overlaid at the bottom:
  Food · Wedding · Portrait · Product · Event · Real Estate
- Section "Choose your tier" — 5 stacked plan cards. Each shows: tier name,
  one-line description, "from ₹X,XXX / 2 hrs", a thin tier-coloured left edge.
  Basic ₹3,500 · Semi-Pro ₹5,500 · Professional ₹8,500 · Expert ₹14,000 ·
  Signature "On request"
- Section "Book again" — one compact past-booking card, "Food shoot ·
  12 Aug · Professional", with a "Rebook" ghost button
- Bottom tab bar: Home, Bookings, Help, Profile

SCREEN 2 — Plan detail (Professional)
Content: full-bleed hero photo, tier badge, price "₹8,500 for 2 hours",
"+₹3,800 per extra hour". An "What's included" list with check icons:
60 edited-quality frames per hour, full-frame camera with lighting,
dual-card backup, certified category specialist, RAW + JPEG delivery in 48h.
A collapsed "What's not included" row. A comparison link
"Compare all tiers". Pinned bottom: "Continue — ₹8,500".

SCREEN 3 — Booking configurator
Content: stepper showing 2 of 4. Location card with the venue address and a
small static map thumbnail, "Change". Date row — horizontal scroll of the next
14 days as day/date pills, 14 Sep selected. Time row — pills in 30-min steps,
4:30 pm selected. Duration stepper — "2 hours" with − and + and a note
"Minimum 2 hours". Category selector — chips, Food selected. Add-ons — three
toggle rows with prices: Second shooter +₹3,000, Drone +₹4,500,
Lighting kit +₹1,500. Pinned bottom bar: running total "₹8,500" and "Review".

SCREEN 4 — Quote review
Content: summary card — Professional · Food · 14 Sep, 4:30–6:30 pm ·
Vesu, Surat. Itemised price breakdown rows: Base 2 hrs ₹8,500,
Drone add-on ₹4,500, Travel (18 km) ₹400, Subtotal ₹13,400, GST 18% ₹2,412,
Total ₹15,812. Then "Pay now (50%) ₹7,906" and a muted line
"Balance ₹7,906 after the shoot". A collapsed T&C acceptance row with a
checkbox. Pinned bottom: "Pay ₹7,906".

SCREEN 5 — Booking confirmed
Content: large success state, amber not green. "You're booked."
Booking ID #CLK-4821. Card with the shoot summary. A vertical timeline with
4 steps, step 1 complete: Booked → Photographer assigned → Shoot day →
Photos in 48h. Muted card: "We'll assign your photographer within 2 hours."
Two buttons: "View booking" primary, "Add to calendar" secondary.

CONSTRAINTS
No lorem ipsum. No dollar signs. No Western names. No drop shadows.
No more than one amber element visible per screen. Do not invent extra
navigation. Keep all five screens visually consistent with each other.
```

### Prompt 2 — Client app, tracking + delivery (5 screens)

```
Same project, same DESIGN.md. 5 more connected screens.

SCREEN 6 — Bookings list
Segmented control: Upcoming / Past. Three upcoming cards, each with a status
badge: "Photographer assigned" (accent), "Awaiting assignment" (warning),
"Tomorrow, 4:30 pm" (neutral). Each card shows category, tier, date/time,
venue area, and thumbnail avatar of the assigned photographer if any.

SCREEN 7 — Booking detail, day-of, photographer en route
Live map at the top, 40% of viewport, showing a moving marker and the venue
pin, with an ETA chip "Arriving 4:22 pm". Photographer card: photo, name
Rahul Mehta, rating 4.9 (127 shoots), "Professional · Food certified", two
icon buttons — Call (masked) and Message. Shoot details card. A "Shoot
starts in 12 min" countdown. Collapsed section "What to prepare".
Ghost link at the very bottom: "Cancel booking".

SCREEN 8 — Booking detail, shoot in progress with extension request
Same layout, map replaced by a live elapsed timer "1h 47m of 2h 00m".
A prominent action card, warning-tinted: "Rahul has requested 1 extra hour.
₹3,800 will be added to your balance." Two buttons: "Approve" primary,
"Decline" ghost. Below, a shoot activity log: Checked in 4:31 pm ·
Waiting time logged 12 min · Shoot started 4:43 pm.

SCREEN 9 — Balance due, photos ready
Success-adjacent state. Headline "Your photos are ready." Card showing
"612 photos · RAW + JPEG · 24.8 GB". A locked-preview block — a blurred
photo grid with a lock icon and the line "Pay the balance to unlock your
download link." Price card: Balance due ₹7,906. Muted note: "RAW files
available for 7 days after delivery. JPEGs for 30 days."
Pinned bottom: "Pay ₹7,906 and unlock".

SCREEN 10 — Delivered
Headline "Download your photos." Two large download cards:
"JPEG — 612 photos, 6.1 GB, available until 14 Oct" with a Download button,
and "RAW — 612 files, 18.7 GB, available until 21 Sep" with a Download button
and a caption "Best downloaded on a computer." Below: an upsell card,
"Want the best 50 professionally edited? Clickco Edit from ₹2,500" with a
"See samples" ghost button. Below that: a rating prompt, 5 stars, "How was
Rahul?"

CONSTRAINTS as before.
```

### Prompt 3 — Pro app (5 screens)

```
Same project, same DESIGN.md, but this is the PHOTOGRAPHER app — Clickco Pro.
Tone is more utilitarian, denser information, less marketing. Same tokens.

SCREEN 11 — Available jobs feed
Header with an availability toggle "Available today" (on) and today's earnings
"₹4,200". A filter row: All / Emergency / Nearby. Job cards, each showing:
distance "3.2 km", payout in large type "₹5,100", category and tier chips,
date/time, venue area, and a countdown "Accept in 1:24". One card is an
emergency job — emergency-red left border and an "EMERGENCY · 2.0×" badge.

SCREEN 12 — Job detail before accepting
Payout breakdown card: Base ₹5,100, Travel ₹400, Total ₹5,500. Shoot
requirements list: Professional tier, Food certified, full-frame + lighting
required, dual-card recording mandatory, 612 frames expected, upload within
6 hours. Venue card with a map thumbnail and the approximate area only —
exact address revealed on accept. Client name shown as "Priya S."
Pinned bottom: "Accept job" with a live countdown on the button.

SCREEN 13 — Active job, ready to check in
Full venue address now visible with a "Navigate" button. Client contact via
masked call. A large disabled primary button "Check in" with the helper text
"Available when you're within 150 m of the venue" and a location-accuracy
indicator. A pre-shoot checklist with checkboxes: dual cards inserted,
batteries charged, lighting kit packed.

SCREEN 14 — Shoot in progress
Big elapsed timer, 1h 47m, with the booked duration underneath. Three action
cards: "Request 1-hour extension", "Log waiting time" (with a note field),
"Add a note". At the bottom, a primary "Check out" button, disabled until the
minimum 2 hours has elapsed, with a countdown.

SCREEN 15 — Earnings dashboard
Big number: this month ₹68,400. A simple 30-day bar chart. Summary row:
Completed 14 · Pending payout ₹11,000 · Avg per job ₹4,885. A ranking card:
"You rank #4 in Surat" with your on-time delivery 100%, acceptance rate 82%,
rating 4.9, and a note "Top 3 get first access to Expert-tier jobs."
Payout list below: dated rows with amounts and status pills.

CONSTRAINTS as before, plus: this app is used one-handed, outdoors, in bright
sunlight and often in a hurry. Prioritise large tap targets and high contrast
over visual delicacy.
```

**Workflow note:** generate, then use Stitch's **Direct Edits** to fix specifics rather than regenerating the whole screen — regeneration burns credits and loses what was already good. Save experimental/Pro mode for the final polish pass on your 6 most important screens.

---

## 6. Stage 2 — Figma cleanup (half a day, non-negotiable)

Paste from Stitch into Figma, then do this before touching Claude Code. Skipping it is the single biggest cause of bad design-to-code output.

1. **Create Variables** for every token in DESIGN.md — colours, spacing, radius, type. Name them exactly as in DESIGN.md (`color/accent/default`, `space/16`). Claude reads these names and writes matching token references.
2. **Bind** every fill, stroke, gap and padding on every frame to a Variable. Any raw hex left behind becomes a hardcoded hex in your codebase.
3. **Auto Layout everywhere.** Absolutely positioned frames produce absolutely positioned RN code, which breaks on every other screen size.
4. **Promote to Components**: Button (3 variants × 3 states), Input, Card, StatusBadge, TierBadge, Chip, BottomSheet, ListRow, EmptyState, Avatar. Ten components cover ~80% of both apps.
5. **Name layers semantically.** `PriceRow`, not `Frame 47`. Claude uses layer names as component and prop names.
6. **One page per surface:** `Client App`, `Pro App`, `Components`, `Tokens`.

Then set up **Code Connect** on those ten components, pointing at your repo paths. From that moment, Claude reuses your real components instead of rebuilding them.

---

## 7. Stage 3 — Claude Code prompts (Figma MCP → React Native)

Setup, once:
```bash
claude mcp add --transport http figma https://mcp.figma.com/mcp
# then inside Claude Code:  /mcp  → figma → Authenticate → Allow Access
```

### Prompt A — Build the token layer first (before any screen)

```
Read /docs/DESIGN.md and the Figma Variables from this file: [FIGMA FILE URL]

Generate packages/design-tokens with:
- tokens.ts       typed token object, exact names from DESIGN.md
- tailwind.preset.js  NativeWind preset consuming tokens.ts
- theme.css       CSS custom properties for the web surfaces

Rules:
- tokens.ts is the single source of truth. Tailwind preset and CSS are derived.
- No hex value may appear anywhere outside tokens.ts.
- Every colour token needs a TS literal type so misuse fails at compile time.
- Do not invent tokens that aren't in DESIGN.md. If something is missing,
  list it at the end instead of guessing.
```

### Prompt B — Build the primitive components

```
Using the Figma MCP get_design_context tool, read the Components page of
[FIGMA FILE URL].

Build these as React Native components in packages/ui/src/:
Button, Input, Card, StatusBadge, TierBadge, Chip, ListRow, EmptyState,
Avatar, BottomSheet

Requirements:
- NativeWind for styling, classes only from our tailwind preset
- Every variant and state from Figma exposed as a typed prop, no boolean soup
- Accessible by default: accessibilityRole, accessibilityLabel, 44pt minimum
  hit targets
- forwardRef where a consumer might need the node
- No inline hex, no magic numbers — tokens only
- One file per component, colocated .test.tsx
- Export a barrel index.ts

For each component, print the prop interface before you write the file and
wait for my confirmation.
```

That last line matters. Reviewing ten prop interfaces takes five minutes; rewriting ten wrong components takes a day.

### Prompt C — Build a screen

```
Read this Figma frame via the Figma MCP: [FRAME URL]

Build it as apps/client/app/(tabs)/index.tsx

Rules:
- Compose from packages/ui only. If you need a component that doesn't exist,
  stop and tell me — do not create a local one-off.
- Data comes from a TanStack Query hook in features/<feature>/hooks.ts.
  Type it from packages/contracts. Never inline a fetch call.
- No hardcoded strings — everything through the i18n helper, English only
  for now.
- Handle four states explicitly: loading (skeleton), empty, error, loaded.
- SafeAreaView insets on top and bottom.
- Prices formatted with formatINR() from packages/utils. Never toLocaleString
  inline.

When done, run the app, screenshot the screen, and compare it to the Figma
frame. List every visual difference you find. Do not tell me it's done until
that list is empty or you've explained why a difference is intentional.
```

### Prompt D — The verification loop

This is the difference between a demo and a product. Claude Code is an excellent front-end engineer and a blind one — it cannot see what it built unless you close the loop.

```
Screenshot the running screen at iPhone 15 Pro dimensions.
Compare against the Figma frame side by side.
Check specifically: vertical rhythm and spacing scale, font sizes and weights,
colour token usage, border radii, tap target sizes, safe-area handling.
Report differences as a table: element / expected / actual / fixed?
Fix everything in the table, then screenshot and verify again.
```

Wire this into a hook so it runs automatically — see Doc 3.

---

## 8. Screen inventory — what to actually design

Don't design all 50 upfront. Design the critical path, build it, learn, then design the rest. AI design is cheap; rework is not.

| Wave | Screens | When |
|---|---|---|
| **Wave 1 — critical path** | Client: home, plan detail, configurator, quote, confirmed, booking detail (en route), balance due, delivered. Pro: jobs feed, job detail, active job, shoot in progress. **12 screens** | Before Sprint 1 |
| **Wave 2 — completion** | Client: onboarding ×4, bookings list, waitlist, rating, profile, help. Pro: onboarding ×5, earnings, payouts, availability, profile. **18 screens** | During Sprint 4 |
| **Wave 3 — states & edges** | Empty states ×6, error states ×4, cancellation flow ×3, dispute flow ×2, emergency variants ×3. **18 screens** | During Sprint 7 |
| **Never designed** | Admin panel (~22 screens), web upload portal (4). shadcn/ui straight from Claude Code. | — |

Wave 1 is one focused morning in Stitch. That's the whole point of using it.

---

## 9. Realistic timeline and cost

| Stage | Time | Cost |
|---|---|---|
| DESIGN.md finalised | 2 hours | free |
| Stitch — Wave 1, 12 screens | 1 day | free (within credits) |
| Figma cleanup, Variables, Components, Code Connect | 1 day | Figma seat, ~₹1,400/mo |
| Token layer + 10 primitives via Claude Code | 1–2 days | — |
| Wave 1 screens built and visually verified | 4–5 days | — |
| **Design-to-working-UI total** | **~9 working days** | ~₹1,400 + a Figma seat |

Compare to hiring a designer for a 50-screen product: 4–6 weeks and ₹1.5–4L. The pipeline above is not a compromise — for a founder-led build with a locked design system, it's a better outcome, because the system stays consistent by construction rather than by discipline.

**The one thing worth paying a human for:** a two-hour paid review of your Wave 1 screens by a good product designer, once, before you build. ₹10–15k, and it catches the taste-level problems no AI tool will flag — hierarchy that's technically correct but reads wrong, an accent colour that fights the photography, a flow with one step too many.

---

## 10. What not to do

- **Don't use Stitch's code export for the mobile apps.** No RN target; converting Tailwind HTML to RN by hand is slower than generating from Figma.
- **Don't design the admin panel.** shadcn/ui is your design system for internal tools.
- **Don't build screens before the token layer and primitives exist.** Every screen built first has to be rebuilt.
- **Don't skip the Figma cleanup.** Unbound hex values and absolute positioning transfer directly into your codebase.
- **Don't let Claude Code create one-off local components.** It will, silently, and you'll end up with four Buttons. Put it in CLAUDE.md as a hard rule (Doc 3).
- **Don't design in light mode "and add dark later."** Pick dark, commit, done.
