# Clickco Pro (photographer app) on the Apple App Store

DRAFT, 4 Nov 2026. Read `README.md` first: the store gate is not met and B1 to B10 apply.
Counts are Unicode code points, including spaces.

## 1. Distribution: what "account required" means here

Clickco Pro is a work tool for photographers under contract with Clickco. Clickco creates every
account: staff add the applicant in the admin panel, check KYC, police verification, PAN and the
bank account, and activate them (`AdminCreateApplicantBody` and the KYC routes in
`apps/api/src/modules/admin/desks/admin-supply.controller.ts`; the `pro_active_requires_verification`
CHECK). The app only signs in: the API sends a code only to the number of an ACTIVE photographer.
For any other number it queues a decoy and sends nothing (`pro-auth.controller.ts`,
`otp.service.ts`).

How the guidelines apply:
- **2.1 App completeness.** Review needs a working account with real-looking data: an open offer,
  an accepted job and paid earnings. Without them the app shows empty states and is rejected as
  incomplete. `[ENG]`: README B3.
- **5.1.1(v) Account sign-in.** An app may require sign-in when its core features are
  account-based. Every Pro screen (offers, jobs, earnings) belongs to one contracted
  photographer, so there is nothing to show signed out. The notes below say so.
- **5.1.1(v) Account deletion.** This applies to apps that let people create accounts, and Pro does
  not. Add a "Request account deletion" row to Profile anyway (README B1) so the answer is ready if
  Review asks.
- **Distribution.** Recommended: **Unlisted app distribution.**
  - Apple offers it for apps meant for a limited audience such as partners and business
    affiliates. The app stays out of search, charts and categories and is reached only by a
    direct link, which Clickco sends at onboarding. It still goes through full App Review.
  - Request it from Apple (Unlisted app distribution request form) before the first submission.
  - Apple Business Manager custom apps do not fit: photographers use their own phones and are
    not an organisation's managed users.
  - Public listing is the fallback. It then needs the apply route in the description, and Review
    may still ask how someone gets an account. `[OWNER]` decides.

## 2. Identity

| Field | Value | Source |
|---|---|---|
| Bundle ID | `in.clickco.pro` | `apps/pro/app.config.ts` |
| Display name under the icon | Clickco Pro | `app.config.ts` `name` |
| SKU | `clickco-pro` | Expo `slug` |
| Primary category | Business | |
| Secondary category | Productivity | |
| Price | Free. No in-app purchases. No payments in the app | |
| Availability | India only | |
| Devices | iPhone only (`supportsTablet: false`) | |
| Seller / copyright | Clicko / "2026 Clicko" `[OWNER]` | |

## 3. Name and subtitle

**Name (max 30)** — 11 characters
```
Clickco Pro
```
**Subtitle (max 30)** — 28 characters
```
For photographers on Clickco
```

## 4. Promotional text (max 170) — 100 characters
```
For photographers registered with Clickco: sign in with the mobile number you gave us at onboarding.
```

## 5. Description (max 4000) — 1,536 characters

`[GATE]` lines:
- "the client approves it before it starts" needs client extension approval (README B7);
- the apply address is `[OWNER]` (README §5 item 13).
```
Clickco Pro is the work app for photographers registered with Clickco in Surat, Mumbai and Vadodara. There is no sign-up in the app. To apply, write to [OWNER: apply address].

New jobs
Offers land in the Jobs tab with the payout, date, hours, category and pincode. Accept before the countdown runs out, or decline. The exact address shows once you accept.

On the day
Tap On my way, then Navigate to open the venue in your maps app. Check in when you arrive: the app takes one location fix as you tap, and Clickco confirms you are within 150 m of the venue. Start the shoot when the client is ready.
Need more time? Request a one-hour extension; the client approves it before it starts. Kept waiting? Log it once. Refused entry, an unsafe site or a client who isn't there: report it from Problem on site and it goes straight to Clickco's ops team.

No signal
Check-ins, check-outs and reports you make offline are saved with the time you tapped and sent when you're back online. Profile lists anything still waiting.

After the shoot
Check out with the frame count from your camera. Upload RAW and JPEG files from a computer through the Clickco upload portal; the Jobs tab counts down each upload deadline.

Earnings
Today, this week and every completed shoot, plus each transfer that reached your bank, with the TDS withheld and the last 4 digits of the UTR.

Location
Clickco Pro reads your location only when you tap Check in, Check out, Log waiting time or send a report from Problem on site. It never tracks you in the background.
```

Facts and where they come from:
- 150 m geofence: `apps/api/src/modules/onsite/onsite.config.ts`.
- One-hour extensions: `ExtensionCard`.
- Offline queue keeps the tap time: `performOnsite`, ADR-0024 D5.
- Uploads through the portal: `UploadsDue.tsx`.
- TDS and UTR last 4: `PaidTransfers.tsx`, `payouts.ts`.
- Foreground-only location: `current-fix.ts` and the `expo-location` plugin config.

Proof shots are not in the build, so they are not mentioned (README B7).

## 6. Keywords (max 100) — 86 characters

Only useful if the listing is public. Unlisted apps do not appear in search, but the field is
still required.
```
jobs,shoots,earnings,payout,checkin,gig,freelance,surat,mumbai,vadodara,offers,partner
```

## 7. Age rating

Same questionnaire as `client-app-store.md` §6. Every answer is No or None, except as noted:
- **User-generated content: No.** Incident, waiting and cancellation notes go to Clickco's ops
  team only; the app tells the photographer "the client never sees this note".
- **Messaging and chat: No.**
- **Realistic violence: None.** The "Unsafe site" report and the "Call 112" button are safety
  tools, not content.

Expected result: **4+**. Who may use the app is set by the vendor agreement, which only adults
sign.

## 8. URLs

| Field | URL | Note |
|---|---|---|
| Support URL | `https://clickco.in/grievance/` | The only page with named contact details. A photographer support page or inbox would fit better: `[OWNER]` |
| Marketing URL | `https://clickco.in/` | Optional |
| Privacy policy URL | `https://clickco.in/privacy/` | Today it covers photographers only for check-in location; it must cover all photographer data first (README B8) |

## 9. App Review information

**Sign-in required:** Yes.

| Field | Value |
|---|---|
| User name | `+91 [OWNER: review photographer number]` |
| Password | `[OWNER: fixed review code]` |
| Contact | `[OWNER: name, phone with +91, email]` |

**Notes:**
```
Clickco Pro is the work app for photographers under contract with Clickco, an on-demand photography service in Surat, Mumbai and Vadodara, India. Clickco creates each photographer's account after KYC, police verification and a signed vendor agreement, so the app has no sign-up and no screen that works signed out (5.1.1(v)). The app does not create accounts; photographers can ask for theirs to be deleted from Profile > Request account deletion [ENG: README B1].

Sign-in: a mobile number and a 6-digit code by SMS. The review number above uses a fixed code and never receives an SMS. It is a review-only photographer: it receives only staged offers, never real jobs.

What to try:
1. Jobs: an open offer shows the payout, date, hours and area. Tap it, then Accept.
2. The accepted job: tap On my way, then Navigate (opens Maps).
3. Check in: the app asks for location While Using the App and takes one fix when you tap. Clickco accepts a check-in only within 150 m of the venue in India, so from your location the server will refuse it with a message. That is expected. A second staged job is already checked in, so you can try Start shoot, Request 1-hour extension and Log waiting time. Check out is geofenced like check-in, so it is refused from outside the venue too; a third staged job is already checked out and shows its upload deadline.
4. Earnings: completed shoots and bank transfers with TDS.
5. Offline: turn on Airplane Mode and tap an on-site action. It is saved with the time you tapped and sent when you are back online; Profile > Sync lists it.

Location is foreground only. There are no background modes and no "Always" permission. The app has no payments, no camera access and no messaging; photographers upload photos from a computer through Clickco's web portal.

[OWNER: link to a screen recording of a real check-in and check-out at a Surat venue, if Review asks.]
```

## 10. Export compliance and content rights
Same answers as `client-app-store.md` §9 and §10. The app encrypts its MMKV store (session and
offline queue) with a Keychain-held key.
