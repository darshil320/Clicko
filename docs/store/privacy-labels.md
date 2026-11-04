# App privacy answers: Apple App Privacy and Google Play Data safety

DRAFT, 4 Nov 2026. Every answer below is derived from the code and the schema, and each row cites
where. Re-derive before each release: anything that adds a field, a module or an SDK changes these
answers.

## 0. Rules used

- **What counts as "collected".** Both stores ask about data that leaves the device through the
  app and that Clickco or a partner keeps longer than the request takes. Data typed into the admin
  panel or the upload portal is not collected *by these apps*; section 3 lists it separately. It
  still belongs in the privacy policy.
- **Status column.**
  - "Now" = in the code today.
  - "From X" = declare it in the first release that includes X. Not before (an over-declaration
    is wrong too), and never after.
- **Tracking: No for every type, in both apps.**
  - No ad SDKs. No IDFA or advertising ID. No App Tracking Transparency prompt.
  - No data goes to data brokers, and none is combined with other companies' data for ads.
  - Sentry and PostHog (ADR-0029) are first-party diagnostics and analytics.
- **Encrypted in transit: Yes, in both apps.**
  - Production builds refuse a non-https API URL (`assertReleaseUrls`:
    `apps/client/app.config.ts:13-21`, `apps/pro/app.config.ts:14-22`).
  - Razorpay's checkout talks to Razorpay over TLS.
  - Provider calls (Razorpay API, Exotel, WhatsApp, SMS, Drive) are server-to-server over HTTPS.
- **Shared (Google's sense): No, in both apps.** Each transfer falls under one of Google's
  exemptions:
  - Service providers acting for Clickco: Razorpay, Exotel (masked calls), Meta WhatsApp and the
    SMS gateway (service messages), Google Drive behind `StoragePort` (shoot files), and Sentry
    and PostHog once added.
  - The assigned photographer gets the booker's name, venue and pincode to do the shoot the user
    booked. Photographers are contracted service providers (`photographer_contracts`).
  - Payment is a user-initiated transfer to Razorpay.
- **Aadhaar is never collected or stored.**
  - CLAUDE.md "Never".
  - `DocumentKind` has no Aadhaar value, by design (`packages/contracts/src/admin-supply.ts:31`).
  - ID proofs keep their last 4 characters only (`photographers.id_proof_last4`,
    `docs/clickco-04-schema.sql`).
- **Deletion path.**
  - Client app: none works today, a **launch blocker** (README B1).
  - Pro app: none in the app; staff offboard (`photographers.offboarded_at`,
    `photographer_documents.purge_after`).
  - The answers below assume B1 lands before submission.

## 1. Clickco (client app)

### 1.1 Inventory

| # | Data | Apple type | Google type | Status | Linked to the user | Purposes (Apple / Google) | Required or optional | Derived from |
|---|---|---|---|---|---|---|---|---|
| C1 | Mobile number (sign-in, booker phone, waitlist, service messages, masked-call bridging) | Contact Info > Phone Number | Personal info > Phone number | Now | Yes | App Functionality / App functionality, Account management, Fraud prevention, security and compliance (OTP limits) | Required | `packages/contracts/src/auth.ts` `RequestOtpBody.phone`; `ReviewView.tsx:176` books with the account phone; `serviceability.ts` `JoinWaitlistBody.phone`; schema `users.phone_e164`, `otp_challenges.phone_e164`, `waitlist_entries.phone_e164` |
| C2 | Name (booker name at checkout, waitlist name) | Contact Info > Name | Personal info > Name | Now | Yes | App Functionality / App functionality, Account management | Required to book; browsing works without it | `apps/client/src/features/booking/lib/draft.ts` `CheckoutForm.bookerName`; `booking.ts` `Contact`; `JoinWaitlistBody.fullName`; schema `users.full_name` |
| C3 | Venue address, landmark, pincode | Contact Info > Physical Address | Personal info > Address | Now | Yes | App Functionality / App functionality | Pincode optional for browsing (prices default to Surat); address required to book | `booking-flow.ts` `CreateBookingBody` (`pincode`, `venueAddress`, `venueLandmark`); `draft.ts` `VenueForm`; `PincodeSheet.tsx`; schema `bookings` |
| C4 | Clickco account ID | Identifiers > User ID | Personal info > User IDs | Now | Yes | App Functionality / App functionality, Account management | Required | `auth.ts` `SessionUser.id` |
| C5 | Bookings, invoices, refunds, credits | Purchases > Purchase History | Financial info > Purchase history | Now | Yes | App Functionality / App functionality | Required | `booking-flow.ts` `BookingSummary`; `client-money.ts`; `BookingMoneySection.tsx`; schema `bookings`, `invoices`, `refunds`, `client_credits` |
| C6 | Payment method and UPI ID or card last 4 | Financial Info > Payment Info | Financial info > User payment info | **From Razorpay checkout** (README B4) | Yes | App Functionality (receipts, refund to the original method) / App functionality | Required to pay | `apps/api/src/modules/payments/gateways/razorpay-webhook.parser.ts:80` writes `p.vpa ?? p.card.last4`; schema `payments.method`, `payments.vpa_or_last4` (README B9). Full card numbers, UPI PINs and bank logins go to Razorpay only. Razorpay's in-app checkout collects them, so both stores count it as collection through the app |
| C7 | Support tickets and photo-quality complaints | User Content > Customer Support | App activity > Other user-generated content | Now | Yes | App Functionality / App functionality | Optional | `packages/contracts/src/client-care.ts` `ClientTicketBody`, `ClientQualityIssueBody`; `apps/client/src/features/care/` |
| C8 | Reviews (rating and comment), reports, blocks | User Content > Other User Content | App activity > Other user-generated content | **From the review / report / block screens** | Yes | App Functionality / App functionality | Optional | `packages/contracts/src/reviews.ts`; migration `0016_reviews_ugc.sql` (`reviews.comment` up to 1,000 characters, `moderation_reports`, `client_photographer_blocks`) |
| C9 | Expo push token and platform | Identifiers > Device ID | Device or other IDs | **From `expo-notifications`** (not yet approved) | Yes | App Functionality / App functionality | Optional (the user can refuse notifications) | `notifications.ts` `RegisterPushTokenBody`; migration `0015` `device_push_tokens` |
| C10 | Masked-call records: who called, status, duration. Never a recording | Usage Data > Other Usage Data | App activity > Other actions | **From the call buttons** | Yes | App Functionality / App functionality, Fraud prevention, security and compliance (per-caller limits) | Optional | migration `0015` `call_bindings`, `call_logs` ("duration only, never a recording"). The spec's `masked_call_log.recording_key` is unused and write-revoked (0015 §6) |
| C11 | Crash reports and performance traces | Diagnostics > Crash Data, Performance Data, Other Diagnostic Data | App info and performance > Crash logs, Diagnostics | **From the Sentry release** (ADR-0029) | Yes if Sentry `setUser({ id })` is called; No if never | App Functionality, Analytics / App functionality, Analytics | Required (no opt-out) unless ADR-0029 adds one | ADR-0029 D2: errors only (no performance traces), no `setUser`, so not linked. Declare from the first release that ships the SDK |
| C12 | Product events (screens, taps), no personal data in properties | Usage Data > Product Interaction | App activity > App interactions | **From the PostHog release** (ADR-0029) | Yes if `identify()` gets the account ID; No if events carry only a random install ID | Analytics / Analytics | Required unless ADR-0029 adds an opt-out | ADR-0029. Declare from the first release that ships the SDK |

### 1.2 Not collected by the client app

| Data | Why not | Source |
|---|---|---|
| Location, precise or approximate | No location module. The pincode is typed, and is declared as part of the address (C3) | `apps/client/package.json` (no `expo-location`) |
| Email address | No email field in the app. Razorpay's checkout asks for one by default: prefill the contact from the account and hide the email field, or this row becomes "collected" | `users.email` exists in the schema but nothing in the client writes it |
| Photos and videos | The app uploads none. Shoot files are taken by the photographer and uploaded through the web portal | `packages/contracts/src/media.ts` header ("the web portal uploads every … byte") |
| Contacts, audio, health, browsing or search history, sensitive info, other financial info | Not touched | No module, no field |
| Device ID | None until push (C9). The client sends no install ID at sign-in | `deviceId` exists only in `apps/pro/src/features/auth/device-id.ts` |
| IP address | Kept on OTP requests for abuse limits. Neither store lists IP as a type of its own, and it is not turned into a location. Name it in the privacy policy | schema `otp_challenges.created_ip`; `otp.repository.ts` |
| Consent records (terms version, model-release opt-in, promo-use opt-in) | Records of consent, not a data type | `CreateBookingBody.acceptedTermsVersion`, `modelReleaseConsent`; schema `users.promo_use_consent` |

### 1.3 Apple App Privacy, first release

"Do you or your third-party partners collect data from this app?" **Yes.**

**Data Linked to You** (purpose App Functionality for each, tracking No):

| Category | Type |
|---|---|
| Contact Info | Name, Phone Number, Physical Address |
| Identifiers | User ID |
| Purchases | Purchase History |
| User Content | Customer Support |
| Financial Info | Payment Info. `[GATE: Razorpay checkout]` |

- **Data Used to Track You:** none.
- **Data Not Linked to You:** none. If ADR-0029 keeps PostHog anonymous, add Usage Data > Product
  Interaction here, with purpose Analytics.
- **Add later, release by release:**
  - Other User Content (C8)
  - Device ID (C9)
  - Other Usage Data (C10)
  - Crash Data, Performance Data, Other Diagnostic Data (C11)
  - Product Interaction (C12)

### 1.4 Google Play Data safety, first release

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | Yes, **only once README B1 ships**. In-app path, plus `https://clickco.in/delete-account/` |
| Account creation | Users can create an account in the app with a phone number and a one-time code |

For every type below: collected **Yes**, shared **No**, processed ephemerally **No**.

| Data type | Required or optional | Purposes |
|---|---|---|
| Personal info > Name | Required | App functionality, Account management |
| Personal info > Phone number | Required | App functionality, Account management, Fraud prevention, security and compliance |
| Personal info > Address | Required | App functionality |
| Personal info > User IDs | Required | App functionality, Account management |
| Financial info > Purchase history | Required | App functionality |
| Financial info > User payment info `[GATE: Razorpay checkout]` | Required | App functionality |
| App activity > Other user-generated content | Optional | App functionality |

Add later: Device or other IDs (C9), App activity > Other actions (C10), App info and performance >
Crash logs and Diagnostics (C11), App activity > App interactions (C12).

## 2. Clickco Pro (photographer app)

### 2.1 Inventory

| # | Data | Apple type | Google type | Status | Linked | Purposes (Apple / Google) | Required or optional | Derived from |
|---|---|---|---|---|---|---|---|---|
| P1 | Mobile number (sign-in) | Contact Info > Phone Number | Personal info > Phone number | Now | Yes | App Functionality / App functionality, Account management, Fraud prevention, security and compliance | Required | `auth.ts` (`PRO_LOGIN`); `apps/api/src/modules/auth/pro-auth.controller.ts`; `SignInView.tsx` |
| P2 | Install ID (random, per install, sent at sign-in "so ops can tell a photographer's phones apart") | Identifiers > Device ID | Device or other IDs | Now | Yes | App Functionality / App functionality, Account management, Fraud prevention, security and compliance | Required (automatic) | `apps/pro/src/features/auth/device-id.ts`; `VerifyOtpBody.deviceId`; schema `refresh_tokens.device_id` |
| P3 | Photographer account ID | Identifiers > User ID | Personal info > User IDs | Now | Yes | App Functionality / App functionality, Account management | Required | session payload (`apps/pro/src/shared/session`) |
| P4 | Location fix at check-in, check-out, waiting log, access-denied and unsafe-site reports, client-absent report. Includes accuracy, device time, an offline flag and a mock-location flag | Location > Precise Location | Location > Precise location, **and** Approximate location (Android 12+ lets the user grant approximate only; the app then sends that fix and the server refuses one worse than 100 m) | Now | Yes | App Functionality / App functionality, Fraud prevention, security and compliance (attendance and billing proof; mocked fixes refused, ADR-0024 D4) | Required for check-in and check-out, which are core to every job. The OS prompt can still refuse it | `apps/pro/src/shared/location/current-fix.ts` (foreground only, a fresh fix per tap); `onsite.ts` `GeoFixBody`, `LogWaitingBody`, `IncidentBody`, `ClientAbsentBody`; `apps/pro/src/shared/offline/queue.ts`; `expo-location` plugin config in `app.config.ts` (no background) |
| P5 | Notes and reasons (incident and waiting notes, decline and cancellation reasons) and the frame count at check-out | User Content > Other User Content | App activity > Other user-generated content | Now | Yes | App Functionality / App functionality | Notes optional; frame count required to check out | `onsite.ts` `Note` fields; `CheckOutFooter.tsx`; `DeclineSheet.tsx`; `CancelJob.tsx` |
| P6 | Work actions with times: accept or decline an offer, on my way, start, extension request, check-out (device time kept for offline replays) | Usage Data > Other Usage Data | App activity > Other actions | Now | Yes | App Functionality / App functionality | Required | `dispatch.ts`; `onsite.ts` (`deviceTs`); schema `assignment_events` |
| P7 | Expo push token | Identifiers > Device ID (already declared as P2) | Device or other IDs (already declared as P2) | **From `expo-notifications`** | Yes | App Functionality | Optional | `notifications.ts`; `device_push_tokens.photographer_id` |
| P8 | Crash and performance data | Diagnostics (as C11) | App info and performance (as C11) | **From the Sentry release** | As C11 | As C11 | As C11 | ADR-0029 |
| P9 | Product events | Usage Data > Product Interaction | App activity > App interactions | **From the PostHog release** | As C12 | Analytics | As C12 | ADR-0029 |

**Background location: none.** No background location permission on either platform, and no
location background mode on iOS. The only iOS string is When In Use. On Android the permissions
are fine and coarse only (`app.config.ts:65-78`; expo-location 56.0.26 plugin source). The
`Navigate` button hands the venue to the maps app on a tap; the app does not keep it
(`apps/pro/CLAUDE.md`: never persist a venue address).

### 2.2 Collected outside the app (not declared on the store forms)

Staff enter these in the admin panel at onboarding. The Pro app neither asks for them nor sends
them. Its Earnings tab only displays results: net amount, TDS, last 4 of the UTR.

| Data | Where it lives | Protection |
|---|---|---|
| Full name, email, city, base pincode | `photographers` | |
| PAN (for TDS) and GSTIN | `photographers.pan_number`, `gstin` | |
| Bank account | `photographer_bank_accounts` | Number sealed (`account_number_enc`, app-side key; `BANK_ACCOUNT_KEY`); last 4 kept for display |
| KYC documents (PAN card, driving licence, passport, voter ID, address proof, police verification, bank proof, drone RPC and UIN, equipment invoices, signed contract) | `photographer_documents` via `StoragePort` | Last 4 only where a number is needed; `purge_after` when the relationship ends. No Aadhaar |
| Gear serials | `photographer_gear.serial_last4` | Last 4 only |

The privacy policy must describe all of this (README B8): today it mentions photographers only for
check-in location.

### 2.3 Not collected by the Pro app
- Photos and videos: uploads go through the web portal (`UploadsDue.tsx`: "Upload from a computer
  at …"). Proof shots are not built (ADR-0024). When they ship, add Photos or Videos and
  `NSCameraUsageDescription`.
- Email, contacts, audio, health, financial info, browsing or search history, sensitive info.
- The client's data shown to the photographer (client display name; the venue once accepted) is
  declared by the client app (C2, C3).

### 2.4 Apple App Privacy, first release

**Data Linked to You** (purpose App Functionality for each, tracking No):

| Category | Type |
|---|---|
| Location | Precise Location |
| Contact Info | Phone Number |
| Identifiers | User ID, Device ID |
| User Content | Other User Content |
| Usage Data | Other Usage Data |

Data Used to Track You: none. Add P8 and P9 with the releases that ship them.

### 2.5 Google Play Data safety, first release

| Question | Answer |
|---|---|
| Collects or shares required data types | Yes |
| Encrypted in transit | Yes |
| Users can request deletion | Yes, once the Profile row and the web page exist (README B1). Until then, answer No: do not claim a path that does not exist |
| Account creation | The app does not let users create an account; Clickco creates photographer accounts outside the app |

For every type below: collected **Yes**, shared **No**, processed ephemerally **No**.

| Data type | Required or optional | Purposes |
|---|---|---|
| Location > Precise location | Required | App functionality; Fraud prevention, security and compliance |
| Location > Approximate location | Required | App functionality; Fraud prevention, security and compliance |
| Personal info > Phone number | Required | App functionality; Account management; Fraud prevention, security and compliance |
| Personal info > User IDs | Required | App functionality; Account management |
| Device or other IDs | Required | App functionality; Account management; Fraud prevention, security and compliance |
| App activity > Other user-generated content | Optional | App functionality |
| App activity > Other actions | Required | App functionality |

Add later: App info and performance (P8) and App activity > App interactions (P9).

## 3. Before each submission
1. Grep both apps for new modules (`package.json`), new contract fields
   (`packages/contracts/src`), and new tables or columns (`docs/schema-addenda`, migrations).
2. Re-check the six "From X" rows against the build being submitted.
3. Update `apps/web/content/privacy.md` in the same release. The stores compare it with these
   labels.
