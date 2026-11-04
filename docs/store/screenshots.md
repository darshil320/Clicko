# Screenshot shot-lists

DRAFT, 4 Nov 2026. Capture from the build you submit, never from a design file. Screens that show
a feature that is not in that build get the app rejected (App Review 2.3; Play's metadata policy).

## 1. Sizes

| Store | Asset | Size | Rules |
|---|---|---|---|
| App Store | iPhone 6.9" | 1320 x 2868 portrait (1290 x 2796 also accepted) | 1 to 10 per app; PNG or JPEG, RGB, no transparency. Simulator: iPhone 16 Pro Max or later |
| App Store | iPhone 6.5" | 1284 x 2778 portrait (1242 x 2688 also accepted) | Optional once 6.9" is supplied (Apple scales it), but supply it to control the crop. Simulator: iPhone 14 Plus or 11 Pro Max |
| App Store | iPad | **None** | `supportsTablet: false` in both `app.config.ts` files |
| Play | Phone screenshots | 1080 x 1920 (9:16) | 2 to 8; JPEG or 24-bit PNG, no alpha. Each side 320 to 3840 px, long side at most twice the short side. Modern 19.5:9 captures break that rule: capture on a 16:9 or 18:9 emulator, or place the capture on a 1080 x 1920 canvas. At least 4 at 1080 px or more keeps the app eligible for Play's recommendations |
| Play | Feature graphic | 1024 x 500 | JPEG or 24-bit PNG, no alpha. Keep text and the subject in the centre: Play crops the edges in some placements |
| Play | Icon | 512 x 512, 32-bit PNG, max 1 MB | Not designed yet (README B5) |
| Play | Tablet screenshots | Skip | Optional; the apps are portrait phone apps |

Use the same order and captions on both stores. Where an App Store shot cannot meet Play's 2:1
limit, use the canvas version for both, so the listings match.

## 2. Caption and frame rules
- One caption per shot, above the screen. Sentence case, no full stop, 40 characters or fewer.
  Each fact appears in one caption only, across the whole set.
- Captions name what the screen proves. No prices: they change by city and date, and guideline
  2.3.7 bars pricing in metadata. The screens may show the engine's own figures.
- Light theme (DESIGN-LIGHT):
  - white or raised-white canvas, ink text (#0E0E10), one weight;
  - amber only as a fill, never as text on white;
  - no gradients, glow, sparkles, icon tiles, badges, ratings or "No. 1" claims;
  - a plain device outline or none.
- Status bar on every shot: 9:41, full battery, full signal, Wi-Fi, no carrier name, no
  notifications.
  - iOS: `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`.
  - Android: system UI demo mode (`sysui_demo_allowed`).
- Capture from a release build (`__DEV__` false) pointed at a staging API. That hides "Fill dev
  OTP", "Simulate payment", the sandbox-payment card and the Developer section, which are all
  `IS_DEV`-only (`apps/*/src/shared/config.ts`).

## 3. What must never appear
- **Phone numbers.** No real phone number on any screen.
  - The client Profile and the OTP screen ("Sent to …") show the account's number, and so does
    the Pro Profile header. Leave those screens out.
  - The `+91 99990 00xxx` dev-seed numbers may belong to real people, so no number at all.
- **People.**
  - No real client or photographer names. Use made-up names that match no one on the roster.
  - No real client faces, or any identifiable person, without a signed model release. The
    website's Pexels sample clips and photos carry no releases (ADR-0023), so they stay off
    store assets.
- **Places.** No home addresses. Venues are public landmarks.
- **Money and accounts.** No real booking references, UTRs, PANs, bank names or amounts from real
  bookings.
- **Promises the build can't keep.** Any copy promising a feature the build lacks:
  - "Card and UPI checkout is coming" (`PaymentView.tsx:187`);
  - "Balance payment opens here soon";
  - the booking phase notes that promise live tracking, masked calling, a live timer, extension
    requests and "download links live here" (`BookingDetailView.tsx:31-73`).
  - `[ENG]` Reword those notes before capture, or pick states where no note shows.
- **Video.** "Video — photos only at launch" in the plan screen's not-included list
  (`catalogue.ts:93`) must not sit beside a video claim (README B7).
- **Legal pages.** A legal page with the "Draft" banner.

## 4. Staged data

No seed stages these states today: `pnpm db:seed:dev` adds staff and demo photographers only, and
refuses a non-localhost database.
- `[ENG]` One staging seed covers both screenshots and the App Review accounts (README B3).
- Pick a quote date that carries no multipliers, so screen figures match the published rate
  card (doc 05 §5):
  - a weekday, a 10:00 start, more than 48 hours ahead;
  - outside every `festival_calendar` window. Wedding season runs 1 Nov to 28 Feb: between
    November and February either choose a March date, if the booking horizon allows, or accept
    that a surge line shows.
- Pincode 395001 (Surat).

## 5. Clickco (client app): 8 shots

| # | Route | State to stage | Caption (characters) |
|---|---|---|---|
| 1 | `app/(tabs)/index.tsx` (Home) | Signed in, pincode 395001 set (subtitle reads "Professional photographers in Surat"), category row, tier list with prices, Emergency banner. No past bookings, so "Book again" stays hidden | Proposal? Content day? Book a pro (33) |
| 2 | `app/plan/[tier].tsx` with `PROFESSIONAL` | Same pincode. Gear, frames per hour, included and not-included lists | Know the kit and frame count first (34) |
| 3 | `app/book/configure.tsx` | Portrait, the date above, 10:00, 2 hours, one add-on (Lighting kit). Venue: a public landmark in Surat | Pick the date, the hours, the add-ons (37) |
| 4 | `app/book/review.tsx` | The same draft. Price lines, the GST line, total and the "pay now" line; a made-up name in "Your name"; terms ticked, model release unticked | The exact price, GST on its own line (36) |
| 5 | `app/book/confirmed/[id].tsx` | Booking CONFIRMED after a Razorpay test-mode payment. `[GATE: Razorpay checkout]` | Pay 50% and you're booked (25) |
| 6 | `app/bookings/[id].tsx` | Status EN_ROUTE: progress timeline, details, payment rows. Phase note reworded first (section 3) | A verified photographer, step by step (37) |
| 7 | `app/bookings/[id].tsx` | Status DELIVERED: two GST invoices (advance, balance), activity list, a refund and a credit in "Refunds and credits", the "Report a problem" entry | RAW + JPEG by secure link in 48 hours (37) |
| 8 | `app/(tabs)/help.tsx` | Two tickets: one "Seen by our team" showing its acknowledge and resolve dates, one resolved with a summary | Stuck? Raise a ticket and track it (34) |

- **Facts, each in one caption:** moments (1), plan details (2), configuring (3), GST shown (4),
  50% advance (5), verified photographers (6), RAW + JPEG and 48 hours (7), help (8).
- **`[GATE: video at launch]`.** If the build books video:
  - Shot 3 shows the Photos / Video / Photos + video choice, captioned "Photos, video or both"
    (21).
  - Add a 9th App Store shot (Play stops at 8; drop shot 2 there) of a video booking's
    review, captioned "Clips arrive unedited, camera-original" (38).
  - Never caption a turnaround time for video, and never show or say "reel".

**Feature graphic (Play):**
- One real photograph from a Clickco shoot with signed releases for everyone in it: a convocation
  or café-launch frame.
- The Clickco wordmark, and one line: "Photographers, booked in minutes" (the site tagline,
  `apps/web/src/content/site.ts`).
- No device mockup, no prices, no "Download now", no store badges.

## 6. Clickco Pro: 8 shots

| # | Route | State to stage | Caption (characters) |
|---|---|---|---|
| 1 | `app/(tabs)/index.tsx` (Jobs) | Two live offers with running countdowns, one marked "Open to all nearby"; one accepted job under active jobs | New jobs with the payout up front (33) |
| 2 | `app/offers/[attemptId].tsx` | Professional, Portrait, 2 hours: payout header, shoot, requirements, venue section "Exact address shown after you accept", the Accept button with its countdown | The whole brief before you accept (33) |
| 3 | `app/jobs/[assignmentId].tsx` | ASSIGNED: venue card at a public landmark, "On my way" and "Navigate" | Navigate to the venue in one tap (32) |
| 4 | `app/jobs/[assignmentId].tsx` | EN_ROUTE at the venue: the fix line "GPS ±12 m · Good" and Check in. **Capture on the iOS simulator** with `xcrun simctl location booted set <venue lat>,<lng>`. An Android emulator's fix is mocked, and the server refuses it (ADR-0024 D4) | Check in within 150 m of the venue (34) |
| 5 | `app/jobs/[assignmentId].tsx` | IN_PROGRESS: shoot timer, an extension request pending ("Lapses at …"), the waiting card, "Problem on site" below | Timer, extensions and waiting time (34) |
| 6 | `app/jobs/[assignmentId].tsx` | Airplane mode after tapping Check out: the sync notice with the queued action and the time it was tapped. Do not use Profile > Sync: its header shows the phone number | No signal? Each tap keeps its time (34) |
| 7 | `app/(tabs)/index.tsx` (Jobs) | A CHECKED_OUT job under "Uploads due" with its countdown, and the subtitle showing the production portal URL (`EXPO_PUBLIC_UPLOAD_PORTAL_URL`, https) | Check out, then upload from a laptop (36) |
| 8 | `app/(tabs)/earnings.tsx` | Today and this week, three completed shoots, two paid transfers: "3 shoots · TDS ₹… · UTR ending 4821" with made-up figures | What reached your bank, after TDS (33) |

- **Facts, each in one caption:** payout (1), brief (2), navigation (3), 150 m geofence (4),
  timer, extension and waiting (5), offline queue (6), uploads through the portal (7), TDS (8).
- No proof-shot screen: it is not built (README B7).

**Feature graphic (Play):**
- A photographer at work, photographed with their written consent; no client faces.
- The "Clickco Pro" wordmark, and one line: "Jobs, check-ins and earnings".
- Same exclusions as the client graphic.

## 7. Before upload
- [ ] Captured from the submitted build, release mode, staging API.
- [ ] Section 3 checked shot by shot.
- [ ] Caption lengths and the one-fact-per-caption rule re-checked after any copy change.
- [ ] The 6.9" and 6.5" sets match. The Play set is cut to 8, then checked against the 2:1 rule.
- [ ] Model releases filed for every person in the feature graphics.
