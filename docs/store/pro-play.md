# Clickco Pro (photographer app) on Google Play

DRAFT, 4 Nov 2026. Read `README.md` first: the store gate is not met and B1 to B10 apply.
Counts are Unicode code points, including spaces.

## 1. Identity and distribution

| Field | Value |
|---|---|
| Package | `in.clickco.pro` (`apps/pro/app.config.ts`) |
| Developer name | Clicko `[OWNER]` |
| Category | Business |
| Tags (up to 5) | Pick the closest in Play Console to: business, productivity, jobs, scheduling |
| Countries | India only |
| Price | Free. No in-app products. Ads: **No** |
| Distribution | Public production listing. Play has no unlisted option for public apps. Managed Google Play private apps need an organisation's EMM, and photographers use their own phones. The listing says plainly who can sign in |

## 2. Main store listing

**App name (max 30)** — 11 characters
```
Clickco Pro
```

**Short description (max 80)** — 77 characters
```
Jobs, venue check-ins and earnings for photographers registered with Clickco.
```

**Full description (max 4000)**: 1,536 characters. Same text and `[GATE]` checks as
`pro-app-store.md` §5. The first paragraph tells anyone who installs it by mistake that there is
no sign-up in the app.
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

## 3. Contact details

| Field | Value |
|---|---|
| Email (required, public) | `[OWNER: photographer support email]` |
| Phone (optional, public) | `[OWNER]` |
| Website | `https://clickco.in/` (B2) |
| Privacy policy | `https://clickco.in/privacy/`. It must cover photographer data first (README B8) |

## 4. App access: the restricted-access declaration

Select **"All or some functionality in my app is restricted"**. Every screen needs a signed-in,
contracted photographer, and Clickco creates those accounts after onboarding. Google's reviewers
must get in, so give them one set of instructions:

| Field | Value |
|---|---|
| Name | Clickco Pro review photographer |
| Username / phone | `+91 [OWNER: review photographer number]` |
| Password / code | `[OWNER: fixed review code]` |
| Any other information | See below |

```
Clickco Pro is for photographers under contract with Clickco; Clickco creates their accounts after KYC and a signed vendor agreement, so there is no sign-up in the app. Sign in with the number above and enter the fixed code (this number never receives an SMS). The account is review-only: it receives staged offers, never real jobs. Check-in and check-out only succeed within 150 m of the venue in India, so they will be refused elsewhere; staged jobs in the checked-in and checked-out states let you see the rest of the flow. Location is requested only while the app is in use.
```

The app runs on the reviewer's emulator or device. On an Android emulator, location comes from a
mock provider, which the server refuses (`mocked: true`, ADR-0024 D4). Expect check-in to fail
there for that reason as well. That is why the staged checked-in job matters.

## 5. Content rating (IARC questionnaire)

| Question | Answer | Why |
|---|---|---|
| Category | All other app types (utility, productivity, communication or other) | |
| Violence, fear, sexuality, language, controlled substances, crude humour | No | |
| Gambling or simulated gambling | No | |
| Users can interact or exchange content | No | Notes go to Clickco's ops team only. There is no chat or calling between users yet; revisit when masked call buttons ship |
| Shares the user's current location with other users | **No** | Check-in fixes go to Clickco, and the client sees only a status ("checked in"). Change to Yes if live tracking for clients ever ships |
| Users can buy digital goods | No | |
| Restricted symbols | No | |
| Web browser or search engine | No | |

Expected: rated for all ages (IARC 3+).

## 6. Target audience and content

- **Target age group: 18 and over only. Appeals to children: No.**
- **Why:**
  - Every user is a contractor who has signed a vendor services agreement (`photographer_contracts`).
  - Each one gives a PAN for TDS under s.194C and a bank account for payouts.
  - None of that is open to minors (Indian Contract Act 1872 s.11).

## 7. Other App content declarations

| Declaration | Answer |
|---|---|
| Ads | No ads |
| Data safety | `privacy-labels.md`, Pro app, Google Play section |
| Account creation and deletion | Accounts are created outside the app by Clickco. In the Data safety form, say the app does not let users create an account. Still give a deletion request route (README B1): `[ENG]` a Profile row, plus the same `https://clickco.in/delete-account/` page as the client app |
| Location permissions | Foreground only. `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION`; no `ACCESS_BACKGROUND_LOCATION`, so no background-location declaration. If Play asks about foreground services, answer that the app uses none (README, Permissions) |
| Financial features | "My app doesn't provide any financial features". Earnings and transfers are display-only |
| Advertising ID | No. Confirm no `AD_ID` permission in the merged manifest |
| Government, health, news | No |

**Prominent disclosure (User Data policy):** location is used only in the foreground, right after a
tap whose purpose is on screen, so the system dialog and the job screen cover it. A one-line note
above the Check in button helps both stores' reviewers. Suggested: "Clickco checks your location
once when you tap, to confirm you are at the venue."

## 8. Graphics
- App icon 512 x 512 (B5).
- Feature graphic and screenshots: `screenshots.md`.
