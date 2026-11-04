# Clickco (customer app) on the Apple App Store

DRAFT, 4 Nov 2026. Read `README.md` first: the store gate is not met and B1 to B10 apply.
Counts are Unicode code points, including spaces.

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Bundle ID | `in.clickco.client` | `apps/client/app.config.ts` |
| Display name under the icon | Clickco | `app.config.ts` `name` |
| SKU | `clickco-client` (App Store Connect only; never shown) | matches the Expo `slug` |
| Primary category | Lifestyle | Booking an in-person service for life moments |
| Secondary category | Photo & Video | Where people look for photography |
| Price | Free. No in-app purchases | Bookings pay for an in-person service through Razorpay (guideline 3.1.3(e)) |
| Availability | India only | Sign-in accepts +91 numbers only (`users_phone_format` CHECK) |
| Devices | iPhone only | `supportsTablet: false` |
| Seller / copyright | Clicko / "2026 Clicko" `[OWNER]` confirm | OD-06 |

## 2. Name and subtitle

**Name (max 30)** — 28 characters
```
Clickco: Book a Photographer
```
`[GATE: video at launch]`: if the launch build books video, use this instead (29 characters).
Do not use it while the app says "photos only at launch".
```
Clickco: Photo & Video Shoots
```

**Subtitle (max 30)** — 30 characters
```
Proposals, trips, content days
```

## 3. Promotional text (max 170) — 128 characters

You can change this without a new review. It holds the list of moments, so the description does
not repeat it. Swap in city or season news when there is some.
```
A weekend in a new city, a surprise proposal, a content day, a birthday, a café launch, convocation. Book a photographer for it.
```

## 4. Description (max 4000)

2,025 characters without the video block; 2,185 with it. Plain text: the App Store renders no
markdown, so section heads are just short lines.

`[GATE]` lines to check against the submitted build:
- step 3 needs Razorpay checkout (B4);
- the "Video" block needs video at launch (B7);
- "Refunds and credits … GST invoice" and "Report a problem" are in the current client code
  (`BookingMoneySection`, `ReportProblem`) and stay.

```
Clickco books a professional photographer for the moments you want on camera, by the hour, in a few taps.

How it works
1. Pick a plan (Basic, Semi-Pro, Professional or Expert), a category, the date, the start time and the hours. Shoots start at 2 hours.
2. See the exact price before you pay, with GST on its own line. Add a second shooter, a lighting kit, drone coverage or 24-hour delivery where your plan allows it.
3. Pay 50% to book. If the shoot is within 24 hours, you pay the full amount up front; when it is less than 3 hours away, the amount is only authorised, and charged when a photographer accepts.
4. A photographer who matches your plan and category is assigned. The booking shows each step: assigned, on the way, checked in, shooting, delivered.
5. Photos arrive by secure link within 48 hours of the shoot ending and the balance being paid.

Who shows up
Every photographer passes KYC, police verification and a portfolio review by our team before their first booking. We never store Aadhaar numbers.

What you get
Every delivered frame as camera RAW plus a full-resolution JPEG. Nothing is colour-corrected or retouched; editing is a separate paid service. RAW files stay up for 7 days after delivery and JPEGs for 30 days, so download them when they land.

Video
Add video to a booking and see its price in the app. Clips arrive unedited, exactly as the camera recorded them. Cutting a reel is a separate paid edit.

Yours to post
Personal and commercial use are both included: your feed, ads, packaging, print, your website. The files can't be resold as stock.

If something goes wrong
Refunds and credits show up inside the booking, next to a GST invoice for every payment. Report a problem with delivered photos, or raise a ticket from Help: we acknowledge within 48 hours and resolve within 30 days.

Where we shoot
Surat and Mumbai are live. Vadodara is in pilot, with limited availability. Somewhere else? Enter your pincode to join the waitlist.

Clickco is operated by Clicko.
Terms: https://clickco.in/terms/
Refunds and cancellations: https://clickco.in/refund-policy/
Privacy: https://clickco.in/privacy/
Grievance Officer: https://clickco.in/grievance/
```

Each fact appears once on the product page:
- moments: subtitle and promotional text (not repeated in the description);
- 2-hour minimum, GST line, 50% / 100% / authorise-only: How it works;
- verified photographers: Who shows up;
- RAW + JPEG, retention: What you get;
- 48-hour delivery: step 5;
- unedited clips: Video;
- personal and commercial use: Yours to post;
- complaint clocks: If something goes wrong;
- cities: Where we shoot.

Every figure comes from T&C v2 (§2.2, §2.4, §4.2 to §4.4, §5.1, §5.4, §9.2, §12) or the website
copy. No price is quoted. Prices change by city and date, and guideline 2.3.7 bars pricing in
metadata.

## 5. Keywords (max 100, comma-separated, no spaces) — 95 characters

Words already in the name and subtitle (Clickco, book, photographer, proposals, trips, content,
days) are indexed already, so they are not repeated here.
```
photoshoot,photography,surat,mumbai,vadodara,birthday,convocation,creator,influencer,cafe,event
```
`[GATE: video at launch]` (97 characters):
```
videographer,video,photoshoot,photography,surat,mumbai,vadodara,birthday,convocation,creator,cafe
```
No competitor names. "reel" is left out on purpose: the app never promises an edited reel
(ADR-0023).

## 6. Age rating

Apple's 2025 questionnaire, by group. Check the exact wording in App Store Connect on the day.

| Question | Answer | Why |
|---|---|---|
| Parental controls | No | |
| Age assurance | No | Eligibility (18+) is a Terms matter (README B10), not an age-verification feature |
| Unrestricted web access | No | No in-app browser. Delivery links open in the system browser |
| User-generated content | **No** for the first release | Support tickets and quality reports are private between the user and Clickco. Change to **Yes** when client reviews become visible to other users; report and block must ship with them (guideline 1.2) |
| Messaging and chat | No | No in-app messaging. Masked calls, when they ship, go over the phone network |
| Advertising | No | No ad SDKs |
| Medical or treatment information | No | |
| Health or wellness topics | No | |
| Profanity or crude humour | None | |
| Horror or fear themes | None | |
| Alcohol, tobacco or drug use or references | None | |
| Mature or suggestive themes | None | |
| Sexual content or nudity | None | |
| Graphic sexual content and nudity | None | |
| Cartoon or fantasy violence | None | |
| Realistic violence | None | |
| Prolonged graphic or sadistic realistic violence | None | |
| Guns or other weapons | None | |
| Simulated gambling | None | |
| Contests | None | Promo codes are discounts, not contests |
| Gambling | No | |
| Loot boxes | No | |
| Made for Kids | No | |

**Expected result: 4+.** Take the calculated rating; do not push it to 18+. Apple's rating
describes content, and this app has none that needs a higher one. Contract age is enforced by the
Terms and the checkout checkbox (B10). Play's 18+ target audience (`client-play.md`) is a separate
setting. v0.2 G-31 asked for "12+", which no longer exists on Apple's scale (4+, 9+, 13+, 16+,
18+). `[OWNER]` confirms this.

## 7. URLs

Only routes that exist in `apps/web/app` (static export with `trailingSlash: true`). All depend
on B2.

| Field | URL | Note |
|---|---|---|
| Support URL | `https://clickco.in/grievance/` | The only page that will carry a named contact, email and phone (T&C §12). Replace with a dedicated support page when one exists; none does today |
| Marketing URL | `https://clickco.in/` | |
| Privacy policy URL | `https://clickco.in/privacy/` | Must be updated first (B8) |
| Licence agreement | Apple's standard EULA | The booking terms are accepted at checkout and linked from the description |

## 8. App Review information

**Sign-in required:** Yes.

| Field | Value |
|---|---|
| User name | `+91 [OWNER: review number]` |
| Password | `[OWNER: fixed review code]` (the 6-digit one-time code; see notes) |
| Contact | `[OWNER: first and last name, phone with +91, email]` |

**Notes** (paste as written; remove any bracketed line that does not apply to the build):
```
Clickco books in-person photography shoots in Surat, Mumbai and Vadodara, India. The shoot is a service delivered outside the app, so bookings are paid through Razorpay rather than in-app purchase (guideline 3.1.3(e)).

Sign-in: an Indian mobile number and a 6-digit one-time code sent by SMS. There is no password and no third-party login, so Sign in with Apple does not apply (4.8). Indian SMS will not reach you, so the review number above uses a fixed code instead: no SMS is sent to it, and the code works only for that number.

To try a booking:
1. Sign in with the number and code above.
2. On Home, tap the location at the top and enter pincode 395001 (Surat).
3. Pick the Professional plan, a weekday at least 3 days ahead, a start time and 2 hours.
4. Review shows the exact price with GST on its own line. Enter a name, accept the terms and tap Pay.
5. [GATE: Razorpay checkout] The review account uses Razorpay's test mode, so no real money moves and no photographer is dispatched. [OWNER/ENG: confirm, or say "please stop at the payment sheet".]

The review account already holds bookings in each state: confirmed, in progress, delivered (with GST invoices, a refund and a credit), and a support ticket under Help.

Account deletion: Profile > Delete account. [ENG: build first, README B1.]

Permissions: the app asks for none: no location, camera, photos, contacts or microphone.

Content: there is no messaging between users. [GATE: reviews] Reviews can be reported, and a photographer can be blocked, from the booking screen.
```

## 9. Export compliance

- The app talks to Clickco over HTTPS (OS encryption).
- It also encrypts its MMKV store with MMKV's own AES implementation. The key lives in the
  Keychain (`docs/PROGRESS.md`, "Mobile M1 closed").
- So the honest answers are: uses encryption, yes; uses standard algorithms beyond the OS's, yes;
  proprietary algorithms, no.
- That is mass-market, standard encryption. It is exempt from an export licence, but it may need
  the annual self-classification report to the US Bureau of Industry and Security.
- Set `ios.config.usesNonExemptEncryption` in `app.config.ts` to match the final answer, so
  builds stop asking. `[OWNER]` signs off.

## 10. Content rights
"Does your app contain, show, or access third-party content?" No. The app shows Clickco's own plans
and the user's own bookings. If licensed sample photos are added to plan screens, change to Yes and
keep the licences on file.
