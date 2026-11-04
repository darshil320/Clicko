# Store listings: Clickco and Clickco Pro

**Status: DRAFT, 4 Nov 2026.** Nothing here has been submitted. The store gate is **not met** (section 3),
and several launch blockers were found while checking the copy against the code (section 4).
Sprint 12 launch prep is recorded in **ADR-0029**. Where this folder and
ADR-0029 disagree, ADR-0029 wins.

## 1. What's here

| File | What it holds |
|---|---|
| `client-app-store.md` | Clickco (customer app) on the Apple App Store: every field, character counts, age rating answers, URLs, App Review notes |
| `client-play.md` | Clickco on Google Play: listing, IARC answers, target audience, contact details, app access |
| `pro-app-store.md` | Clickco Pro (photographer app) on the App Store, incl. the account-required and Unlisted distribution notes |
| `pro-play.md` | Clickco Pro on Google Play, incl. the restricted-access declaration |
| `privacy-labels.md` | Apple App Privacy and Google Play Data safety answers for both apps, derived from the code, with sources |
| `screenshots.md` | Sizes, shot order, routes, staged data, captions and what must not appear, per app and store |

Conventions used in every file:
- `[OWNER]` = only Darshil can supply or decide it (legal, accounts, contacts).
- `[ENG]` = engineering work that must land before the field is true.
- `[GATE: …]` = copy that is only true once the named feature is in the submitted build. Remove it
  if the feature is not in that build (App Review guideline 2.3, accurate metadata).
- Character counts are Unicode code points, counted with a script, and include spaces and line
  breaks. Both stores count the same way for these fields.
- No prices appear in names, subtitles, keywords or captions (App Review guideline 2.3.7 bars
  pricing information in metadata). Screens may show the engine's own figures.

## 2. Sources this copy follows
- Positioning: ADR-0023 (Gen Z, creators, everyday moments; photos and video; video is unedited,
  camera-original, priced in the app; personal and commercial use per T&C §9.2).
- Tone: ADR-0028 (no generated-site tropes, each fact once), DESIGN-LIGHT.
- Facts: T&C v2 draft (`docs/clickco-terms-conditions-v2.md`), rate card (doc 05 §5), the website's
  own copy (`apps/web/src/content/home.ts`, `site.ts`, `cities.ts`).
- "Verified" is used for photographers only (KYC, police verification, PAN and bank checks are
  required for an ACTIVE photographer: `pro_active_requires_verification` in
  `docs/clickco-04-schema.sql`). Videographers are never called verified (no vetting rubric yet,
  ADR-0023 Consequences).

## 3. Store gate: NOT MET

From PLAN.md §3 (S12 gate) and B7. All four must be true before either store submission:

| Gate item | State on 4 Nov 2026 |
|---|---|
| D-U-N-S number for Clicko, then an Apple Developer Program **organisation** account | Not started (B7: 1 to 3 weeks) |
| Google Play Console **organisation** account (Google also asks organisations for a D-U-N-S number; an organisation account also skips the 12-tester, 14-day closed test that new personal accounts must run) | Not started |
| T&C v2 published with zero `[BRACKETS]`, after legal review | Not met: entity address, Grievance Officer, privacy email still open (OD-06, OD-09). The web legal pages show a "Draft" banner until `apps/web/src/legal/config.ts` has no `To be confirmed` values |
| A named Grievance Officer (name, email, phone, address) | Not met (OD-09) |

## 4. Launch blockers found while drafting

Each one would get either app rejected, or make a listed claim untrue.

**B1. Account deletion does not exist (client app). LAUNCH BLOCKER.**
- Apple requires in-app account deletion for any app that creates accounts (guideline 5.1.1(v),
  in force since 2022). The client app creates an account on first OTP sign-in
  (`SessionUser.isNew`, `packages/contracts/src/auth.ts`).
- Google Play requires an in-app path **and** a web URL where users can request deletion without
  reinstalling the app.
- What exists today:
  - A "Delete my data" support ticket category (`apps/client/src/features/care/lib/tickets.ts:34`).
    Staff see it in the tickets desk; nothing executes a deletion.
  - No API route: `apps/api/src/modules/users/users.controller.ts` has only `GET /me`. No
    `deleted_at` or erasure procedure exists in the schema or the migrations.
  - No web page: `apps/web/app` has no deletion route.
- The schema makes it a design task, not a button:
  - `users.phone_e164` is `NOT NULL`, unique, and CHECKed against `^\+91[6-9][0-9]{9}$`, so a
    deleted account cannot simply null or tombstone its phone. That needs a schema addendum (next
    free: 0019) and an ADR.
  - Tax invoices, payments and ledger rows must be kept for the statutory period (GST: 72 months
    from the due date of the annual return, CGST Act s.36), so deletion means anonymising the
    account and keeping the money records.
- Proposed shape (`[ENG]` + ADR):
  - Profile, then "Delete account", then a screen saying what goes and what stays, then an OTP
    confirmation.
  - Refuse while a booking is live or money is owed either way, and say why.
  - Then revoke sessions and push tokens, anonymise the `users` row, and drop preferences, blocks
    and waitlist rows. Write an audit and outbox event in the same transaction.
  - Add a web page at `https://clickco.in/delete-account/` for Play.
- Pro app: accounts are created by staff, not in the app (`AdminCreateApplicantBody`,
  `packages/contracts/src/admin-supply.ts`), so 5.1.1(v) and Play's rule do not strictly apply.
  Add a "Request account deletion" row in Pro Profile anyway (DPDP Act 2023 s.12 erasure right).

**B2. The domain does not resolve.** `clickco.in` returned NXDOMAIN on 4 Nov 2026. The site is
live only at `https://clickco-web.vercel.app`. Every store URL (support, marketing, privacy) and
the API (`https://api.clickco.in`, required by `apps/web` deploys and both production app builds)
depends on it. `[OWNER]`

**B3. App Review cannot sign in to either app.**
- OTP SMS goes through MSG91 (`SMS_ADAPTER=dlt`, built 4 Nov in `256f228`), but sends only once
  the TRAI DLT entity, header and OTP template are approved (PLAN B6).
- Reviewers outside India cannot receive an Indian SMS in any case. There is no review-account
  mechanism.
- `[ENG]` A per-app review number with a fixed code:
  - set by env in production, never sent by SMS, rate-limited, audited;
  - its bookings never dispatch to real photographers and never move real money;
  - the Pro review photographer is excluded from real dispatch.
- The ACTIVE photographer CHECK means the Pro review account needs its verification timestamps
  set.

**B4. No payment in the client app yet.**
- `apps/client/src/features/booking/components/PaymentView.tsx:187` shows "Card and UPI checkout
  is coming". Balance payment says "opens here soon" (`BookingDetailView.tsx:62`).
- Razorpay checkout is a new dependency and needs owner approval.
- "Pay 50% to book" and the payment rows in `privacy-labels.md` are only true once it ships.

**B5. App icons and splash are not configured.** Neither `apps/client/app.config.ts` nor
`apps/pro/app.config.ts` sets `icon`, `android.adaptiveIcon` or a splash, and neither app has an
`assets/` folder. A build would carry Expo's placeholder icon (guideline 2.1/2.3 rejection).
Needed: a 1024 x 1024 App Store icon with no alpha, and a 512 x 512 Play icon.

**B6. No privacy policy link inside either app.**
- Apple 5.1.1(i) needs one in the app, not only in App Store Connect.
- The client shows "clickco.in/terms" as plain text in the review screen
  (`ReviewView.tsx:130`).
- Pro has no legal links at all. G-45 (v0.2 spec) also wants terms, refund and privacy reachable
  before payment.
- `[ENG]` Add Terms, Refund policy, Privacy and Grievance rows to both Profile tabs.

**B7. Listed features that are not in the build yet.** The copy carries `[GATE]` markers. Remove
each marked line, or ship the feature, before submission:

| Claim | State in code |
|---|---|
| Video bookings | The client says "Video — photos only at launch" (`apps/client/src/shared/catalogue.ts:93`). This contradicts ADR-0023 and the website FAQ. **Two docs disagree:** `[OWNER]` decides whether launch includes video |
| Pay 50% / balance in app | B4 |
| Live tracking of the photographer | Not built. `BookingDetailView.tsx:43` promises it "on the shoot day". The copy here says only that the booking shows each step |
| Client approves extensions in the app | Not built in the client. The Pro app already tells photographers the client approves "in their app" (`ExtensionCard`) |
| Download links inside the booking | Not built. The link arrives by WhatsApp or SMS, which wait on Meta templates and DLT (HANDOVER §8) |
| Reviews, report and block | Server done (0016). App screens not built (HANDOVER §4 D4). Publishing reviews in-app without report and block fails guideline 1.2 |
| Push notifications, masked call buttons | Need `expo-notifications` (not approved) |
| Pro "proof shots" | Not built: no camera module, no permission string, no API route (ADR-0024 "Not in this sprint"). Not mentioned in the Pro copy |

**B8. The privacy policy does not match the labels.**
- `apps/web/content/privacy.md` says shoot files are "photographs" only (no video).
- It names photographer location only "at check-in and check-out". The code also reads it for
  waiting logs, incident reports and client-absent reports.
- It omits support tickets, reviews, push tokens, the Pro install ID, IP addresses kept for OTP
  abuse limits, photographer KYC, PAN and bank data, and crash or analytics data once
  Sentry/PostHog ship.
- Apple and Google both compare the policy to the labels. Update it in the same change that
  submits the labels. Not edited here: out of scope for this task.

**B9. The full UPI ID is stored.**
- `razorpay-webhook.parser.ts:80` copies `p.vpa ?? p.card.last4` into `payments.vpa_or_last4`.
- ADR-0027 L1 ("payer email, contact and VPA are never stored") covers the stored webhook
  payload only.
- Either declare it as payment info (done in `privacy-labels.md`) or store a masked VPA. Refer to
  the security-reviewer.

**B10. No minimum age in the Terms.**
- Both listings set an 18+ audience (contract capacity: Indian Contract Act 1872 s.11).
- DPDP Act 2023 s.9 requires verifiable parental consent for anyone under 18.
- T&C v2 has no eligibility clause, and the client's terms checkbox does not say "I am 18 or
  older".
- The T&C is a read-only spec: `[OWNER]` adds the clause with the lawyer, then `[ENG]` updates the
  checkbox copy.

### Permissions and background location (checked, not blockers)
- **Client app:** no runtime permissions. No location, camera, photos or contacts module in
  `apps/client/package.json`. `expo-secure-store` has `faceIDPermission: false`.
- **Pro app:** foreground location only.
  - `expo-location` runs with `isIosBackgroundLocationEnabled: false`,
    `isAndroidBackgroundLocationEnabled: false`, and the Always and motion strings set to `false`.
  - The only iOS string is `NSLocationWhenInUseUsageDescription`: "Clickco Pro checks your
    location when you check in and out of a shoot, to confirm you are at the venue." That string
    understates use: the app also reads location for waiting logs and safety reports. Suggested
    wording: "Clickco Pro checks your location when you check in or out, log waiting time or
    report a problem at a shoot."
  - The plugin adds only `ACCESS_COARSE_LOCATION` and `ACCESS_FINE_LOCATION` on Android. With
    background off, `FOREGROUND_SERVICE_LOCATION` is not added (plugin source, expo-location
    56.0.26).
  - The library manifest still declares a `LocationTaskService` with
    `foregroundServiceType="location"`. Check the merged manifest in the first AAB. If Play asks
    for a foreground-service declaration, answer that the app uses none.
- **Both, on the first prebuild:** check the merged Android manifest for template defaults
  (`READ_/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`) and for
  `com.google.android.gms.permission.AD_ID`. Remove any with `android.blockedPermissions`.
- **Later:** push adds `POST_NOTIFICATIONS` (Android 13+). Pro proof shots would add
  `NSCameraUsageDescription` and `CAMERA`. Both change the privacy labels too.

## 5. [OWNER] items

1. Registered address of Clicko (OD-06).
2. Grievance Officer: name, email, phone, address (OD-09).
3. Public support email and phone for both listings (Play makes the email public; Apple's support
   URL page must show contact details).
4. Privacy contact email (privacy policy, T&C §9.4 and §11.4).
5. D-U-N-S number, then the Apple organisation enrolment and the Play organisation account.
6. Publish T&C v2 with no `[BRACKETS]`, after legal review. Add the 18+ eligibility clause (B10).
7. Point `clickco.in` and `api.clickco.in` at the site and the API (B2).
8. App Review contacts (name, phone, email). Approve one review number per app and its fixed code
   (B3).
9. Approve the new dependencies: Razorpay checkout, `expo-notifications` (pending), Sentry and
   PostHog (ADR-0029), and a camera module if proof shots are wanted.
10. Video at launch: yes or no (B7). It decides the client app name, keywords and two captions.
11. Photos for screenshots and the feature graphics, with signed model releases for every
    identifiable person. The website's Pexels samples carry no releases (ADR-0023).
12. Pro distribution on iOS: Unlisted (recommended) or public (`pro-app-store.md` §1).
13. Where photographers apply. `apps/web/src/content/site.ts` uses a placeholder
    `join@clickco.in`.
14. Seller and copyright names on the stores: "Clicko" / "2026 Clicko".
15. Sign off the export-compliance answer (`client-app-store.md` §9).
16. Confirm the age-rating stance. v0.2 G-31 said "12+", a rating Apple no longer has. The
    recommendation is in `client-app-store.md` §6.

## 6. Submission checklist

**Both stores**
- [ ] Store gate met (section 3).
- [ ] B1 to B10 closed, or the affected copy removed.
- [ ] `clickco.in/privacy/`, `/terms/`, `/refund-policy/`, `/grievance/` load over https with no
      "Draft" banner. The production web build refuses to ship with unresolved fields
      (`LEGAL_STRICT`).
- [ ] Privacy policy updated to match `privacy-labels.md` (B8).
- [ ] Review accounts work from outside India. Staged data present (`screenshots.md` lists the
      states).
- [ ] Production builds use https API URLs (enforced by `assertReleaseUrls` in both
      `app.config.ts`).
- [ ] Version: both configs say `0.1.0`. Decide whether the first public release is `1.0.0`.
- [ ] Availability: India only. Sign-in accepts +91 numbers only (the `users_phone_format` CHECK),
      and India-only availability avoids the EU DSA trader disclosure.
- [ ] Price: free. No in-app purchases. No ads.
- [ ] Every `[GATE]` line checked against the submitted build.
- [ ] Screenshots captured from the submitted build, per `screenshots.md`.

**Apple (per app)**
- [ ] App Privacy answers entered (`privacy-labels.md`). Privacy policy URL set.
- [ ] Age rating questionnaire answered (each app's §6).
- [ ] Export compliance answered. `ios.config.usesNonExemptEncryption` set in `app.config.ts` to
      match.
- [ ] App Review notes and sign-in pasted. Contact details filled.
- [ ] Pro: Unlisted distribution requested before submission, if chosen.
- [ ] No iPad screenshots: `supportsTablet: false` in both configs.

**Google Play (per app)**
- [ ] Data safety form (`privacy-labels.md`), including the account deletion URL.
- [ ] App access: instructions and credentials (each Play file).
- [ ] Content rating (IARC), target audience 18+, Ads: No.
- [ ] Financial features declaration: "My app doesn't provide any financial features" (bookings
      pay for an in-person service; earnings are display only).
- [ ] Advertising ID declaration: No, after confirming no `AD_ID` permission in the merged
      manifest.
- [ ] Health, news and government declarations: not applicable.
- [ ] Feature graphic 1024 x 500, icon 512 x 512, 4 to 8 phone screenshots.
- [ ] Internal testing track first. Read the pre-launch report before production.
