# ADR-0024 — Sprint 6 frontend: the Clickco Pro app

**Status:** Accepted 28 Oct 2026. Taken on Darshil's behalf and overridable. The one new dependency,
`expo-location` 56.0.26, was approved by Darshil on 28 Oct 2026.
**Sources:** PLAN §2 S6 ("full shoot on two phones"); v0.2 G-15 (geofence), G-16 (extensions), G-19
(offline queue); doc 01 Prompt 3 screens 11–15; doc 02 (the Pro app uploads nothing heavy — RAW goes
through the web portal); ADR-0011/0012 (offers, assignments), ADR-0013 (on-site API),
ADR-0015 M3 (mocked GPS), ADR-0017 (white theme).

## D1 — Shape
- `apps/pro` is a second Expo SDK 56 app. It uses the same pinned toolchain as `apps/client`
  (expo-router, NativeWind, TanStack Query, Zustand + MMKV, `@clickco/ui`), plus `expo-location`.
- Bundle ids are `in.clickco.pro` / slug `clickco-pro`. Web runs on :8082 for development only:
  real check-ins need a phone.
- **White theme** (`lightTailwindPreset`). The packages/ui primitives are already light, and a
  single look across the two apps is cheaper than a dark Pro variant.
- Tone follows doc 01 Prompt 3: utilitarian, denser, money in large tabular numerals.

## D2 — API access
- **`createProApiClient`** in `@clickco/api-client` types every `/pro/*` route the app uses: auth,
  offers, assignments, on-site and earnings.
- `HttpOptions.refreshPath` (default `/auth/refresh`) lets the Pro client refresh against
  `/pro/auth/refresh`.
- Screens never fetch: each feature's `api.ts` calls the shared client.

## D3 — Screens (doc 01 screens 11–15)
| Route | What |
|---|---|
| `sign-in` | Phone OTP (`PRO_LOGIN`). Dev builds can fill the dev OTP. |
| `(tabs)/index` "Jobs" | Offer feed: payout, distance, area, tier/category, start, live "Accept in m:ss"; emergency offers marked. Below it, today's and upcoming active jobs, and uploads that are due. Polls every 10 s while focused (push is S11). |
| `offers/[attemptId]` | Offer detail: payout, requirements, area only (the address is revealed on accept), Accept with the countdown, and Decline with an optional reason. |
| `jobs/[assignmentId]` | The active job, one screen whose content follows the state: address + Navigate + checklist → en-route → check-in (GPS fix and accuracy shown) → start → elapsed timer, extension, waiting, notes → check-out with frame count. Access-denied, unsafe-site and client-absent reports are always reachable. Cancel (with its penalty warning) is available until check-in. |
| `(tabs)/earnings` | Today / week / month / pending (expected gross, `basis: EXPECTED`), and the job list. |
| `(tabs)/profile` | Name, phone, sign out, app version, and the sync queue status. |

Doc 01 elements left out, because the API has no data for them yet:
- the availability toggle (photographer schedules are ops-managed until S9);
- the city ranking card and the 30-day bar chart;
- masked calling (Exotel, S11);
- the map thumbnail (no maps SDK).

## D4 — Geofence on the device
- The venue's coordinates never reach the app, so the 150 m decision stays on the server
  (ADR-0013 D3). The Check in button is enabled once the app has a fix; the server's 422
  (`OUTSIDE_GEOFENCE` with `distanceM`, `LOCATION_TOO_INACCURATE`) is shown in plain words.
- The app asks for foreground location only, with high accuracy, a fresh fix and a 20 s timeout.
  No background location.
- **Mocked fixes (ADR-0015 M3):**
  - `GeoFixBody` gains `mocked` (default `false`), taken from expo-location's `mocked` flag
    (Android).
  - The API refuses a mocked fix with 422 `LOCATION_MOCKED` on check-in, check-out and
    client-absent.
  - Incident reports are never refused: safety first.

## D5 — Offline write-ahead queue (G-19)
On-site actions go through one MMKV-persisted FIFO queue per device:
- en-route, check-in, start, extension request, waiting, incidents, client-absent and check-out.

**When the action is taken:**
- The app first tries the call directly.
- If it fails with a **network** error (no response at all), the action is queued instead.
  - The queued action keeps `deviceTs` (captured when the photographer tapped), `offline: true` and
    one fixed `Idempotency-Key`.
  - The job screen then moves ahead optimistically: "Checked in · waiting to sync".
- An HTTP error (4xx/5xx) is shown immediately and nothing is queued: the server answered.

**Flushing:**
- The queue flushes in order:
  - on app foreground,
  - every 15 s while it is not empty,
  - and after any successful on-site call.
- Within one assignment it stops at the first item that still fails on the network. A later
  action never overtakes an earlier one.
- **Outcomes:**
  - A success or a replay (`replayed: true`) removes the item.
  - A 4xx moves it to a "needs attention" list with the server's message, and the job is refetched.
    `ASSIGNMENT_NOT_ACTIVE` after a no-show is already alerted to ops by the API.
  - A 5xx or network failure stays queued, with backoff.
- The server already makes replays safe:
  - `deviceTs` dedupes;
  - the device time is authoritative only when `offline` and within 6 h (ADR-0013 D4/D5);
  - repeating en-route or start is a no-op.

**Local view of the job:**
- The pure `projectJob(detail, pending)` gives the state the screen shows. Tested.
- The pure `earliestCheckOut` mirrors ADR-0013 D6 while offline:
  max(check-in, scheduled start) + booked + approved extension hours. Tested.
- Signing out with items still queued asks first: those actions would be lost.

## D6 — What the app stores
- MMKV id `clickco.pro` holds two things: the session (tokens + `ProSessionPhotographer`) and the
  queue. Android Auto Backup is off.
- Nothing secret goes in `EXPO_PUBLIC_*`.
- Venue addresses come from `GET /pro/assignments/:id` and are never persisted. The query cache is
  memory-only and is cleared on sign-out.

## Security review, 28 Oct 2026
No critical or high findings. The fixes below were made before the commit.
- **Retries after a timeout:**
  - A copy queued after a timeout gets a fresh Idempotency-Key whenever marking it offline
    changes its body. Before, the server could answer `IDEMPOTENCY_KEY_REUSED` for a check-in it
    had already recorded.
  - The `deviceTs` replay rule still dedupes the event.
- **Session expiry:**
  - Saved actions survive an expired session; the sign-in screen says they are waiting.
  - Explicit sign-out clears them, after a warning.
  - A different photographer signing in keeps only their own.
  - The session is captured before each send, so an action never queues under another person.
- **Safety reports** (access denied, unsafe site):
  - They fall back to the phone's last known position when no fresh fix comes.
  - They may go ahead of a job's queued actions once its check-in has been sent.
- **Stale data:**
  - Fixes older than 30 s are treated as cached and refused for geofenced actions.
  - Saved actions older than 6 h are not sent; they are shown as not sent.
  - Refused actions keep only their outcome, never the location or the note.
- **Server:** a mocked fix can no longer raise `offline_check_in_after_no_show`.
- **Config:**
  - iOS "Always" and motion permission strings are omitted.
  - A production EAS build fails unless the API and portal URLs are https.

**Open, with owners:**
- **M1 — tokens and the queue sit in unencrypted MMKV; backups are only partly excluded.** Fix
  before launch:
  - keep the refresh token in Keychain/Keystore (`expo-secure-store`, a new dependency that
    needs approval), or encrypt MMKV with a key held there;
  - exclude MMKV from Android data extraction and from iOS backup.
  - The same item is already open for `apps/client`.
- **L2 — start and en-route carry no `deviceTs`.** A queued start is recorded at sync time.
  Add `{deviceTs, offline}` to both endpoints (API change, S9).
- **L1 (rest) — mock attempts are not visible to ops.** Log refused mocked fixes outside the
  transaction and alert ops past a threshold (S9). Add `mocked`/`accuracyM` to waiting and
  incident bodies, for audit only.
- **M4 (rest) — no fix at all still blocks a safety report.** `IncidentBody` requires
  `lat`/`lng`; making them optional is a contract change for domain review (S9).

## Not in this sprint
Proof-of-attendance photos (doc 02), push notifications for new offers (S11), masked calls (S11),
availability and schedules (S9), EAS builds (S12).
