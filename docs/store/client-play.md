# Clickco (customer app) on Google Play

DRAFT, 4 Nov 2026. Read `README.md` first: the store gate is not met and B1 to B10 apply.
Counts are Unicode code points, including spaces.

## 1. Identity

| Field | Value | Source |
|---|---|---|
| Package | `in.clickco.client` | `apps/client/app.config.ts` |
| Developer name | Clicko `[OWNER]` confirm | OD-06 |
| Category | Lifestyle | Same reasoning as the App Store primary. Play's "Photography" category is for camera and editing apps |
| Tags (up to 5, from Play Console's list) | Pick the closest to: photography, event planning, local services, booking. Play's tag list changes; choose in Store settings > Tags | |
| Countries | India only | +91-only sign-in |
| Price | Free. No in-app products. Ads: **No** | |

## 2. Main store listing

**App name (max 30)** — 28 characters
```
Clickco: Book a Photographer
```
`[GATE: video at launch]` alternative (29 characters): `Clickco: Photo & Video Shoots`

**Short description (max 80)** — 72 characters. It sits above the full description and holds the
moments, so the full description does not repeat them.
```
Book a photographer for a proposal, a trip, a birthday or a content day.
```

**Full description (max 4000)**: 2,025 characters without the video block, 2,185 with it.
- It uses the same text as the App Store description (`client-app-store.md` §4), with the same
  `[GATE]` checks.
- Play's metadata policy is met: no emoji, no ALL-CAPS words, no "best" or "#1", no
  testimonials, no prices.
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

## 3. Contact details (Store settings)

| Field | Value |
|---|---|
| Email (required, shown publicly) | `[OWNER: support email]` |
| Phone (optional, shown publicly) | `[OWNER: support phone]` |
| Website | `https://clickco.in/` (B2) |
| Privacy policy (App content) | `https://clickco.in/privacy/`. Update it first (B8) |

## 4. Content rating (IARC questionnaire)

| Question | Answer | Why |
|---|---|---|
| Category | All other app types (utility, productivity, communication or other) | A booking app; not a game, social network, news, education or streaming app |
| Violence | No | |
| Fear | No | |
| Sexuality | No | |
| Language | No | |
| Controlled substances | No | |
| Crude humour | No | |
| Gambling or simulated gambling | No | |
| Users can interact or exchange content (text, voice, images) | **No** for the first release | Support tickets go to Clickco only. Revisit when masked call buttons or public reviews ship |
| Shares the user's current location with other users | No | The client app reads no location at all |
| Users can buy digital goods | No | Bookings pay for an in-person service |
| Contains swastikas or other restricted symbols | No | |
| Is a web browser or search engine | No | |

Expected: rated for all ages (IARC 3+). The content rating describes content only. Who the app is
for is set below.

## 5. Target audience and content

- **Target age group: 18 and over only.** Do not tick any under-18 band.
- **Appeals to children:** No.
- **Why 18+:**
  - Every booking is a paid contract: an advance, a balance, cancellation charges and an
    equipment-damage liability (T&C §2, §3, §8.2). A minor cannot enter a binding contract in
    India (Indian Contract Act 1872 s.11).
  - The DPDP Act 2023 s.9 treats anyone under 18 as a child. It requires verifiable parental
    consent to process their data and bars behavioural monitoring of them, and the app has no
    parental-consent flow.
  - Choosing any under-13 band brings the app into Google Play's Families policy, with
    obligations this app does not need.
  - Minors may still be photographed at a booking. The adult booker confirms a parent's consent
    (T&C §7.4).
- **Follow-up:** the Terms need a matching eligibility clause, and the checkout checkbox should
  say "I am 18 or older" (README B10).

## 6. App access

Select **"All or some functionality in my app is restricted"** and add one set of instructions:

| Field | Value |
|---|---|
| Name | Clickco review account |
| Username / phone | `+91 [OWNER: review number]` |
| Password / code | `[OWNER: fixed review code]` |
| Any other information | See below |

```
Sign in with the phone number above. On the code screen enter the fixed code above: this review number never receives an SMS. Then set pincode 395001 (Surat) from the location at the top of Home to see prices and book. The account already holds bookings in each state (confirmed, in progress, delivered with invoices, a refund and a credit) and a support ticket under Help. [GATE: Razorpay checkout] Payments for this account run in Razorpay test mode and never dispatch a photographer.
```

## 7. Other App content declarations

| Declaration | Answer |
|---|---|
| Ads | No ads |
| Data safety | `privacy-labels.md`, Client app, Google Play section |
| Account deletion URL | `https://clickco.in/delete-account/`. **Does not exist yet (README B1).** Play will not accept the form without a working URL |
| Financial features | "My app doesn't provide any financial features". Paying for an in-person service through a payment gateway is not a financial feature |
| Advertising ID | No. First confirm there is no `com.google.android.gms.permission.AD_ID` in the merged manifest |
| Government app | No |
| Health app | No |
| News app | No |

## 8. Graphics
- App icon: 512 x 512, 32-bit PNG, max 1 MB (B5: not designed yet).
- Feature graphic and phone screenshots: `screenshots.md`.
