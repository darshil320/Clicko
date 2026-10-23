# ADR-0015 — Sprint 6–7 security review: fixes and accepted risks

**Status:** Accepted 23 Oct 2026 (taken on Darshil's behalf; overridable)
**Sources:** security-reviewer report on b3d06e3 (on-site) and 0c9e854 (media); domain-guardian
review of the same commits; ADR-0013, ADR-0014.

3 high, 9 medium and 8 low findings. Each is fixed, decided, or accepted with a trigger for
revisiting it.

## Fixed

| # | Finding | Fix |
|---|---|---|
| H1 | Shoot time could be billed as waiting | `waitingElapsedMinutes` is bounded by `shoot_started_at` (ADR-0013 D9). The e2e scenario that relied on the bug now starts the shoot when the client is ready. |
| H2 | An offline check-in could be backdated to before acceptance, up to 6 h | The device-time floor is `max(block start, accepted_at, start − 3 h)`. A check-in is trusted for 60 min, not 6 h. A device time that turns a late arrival (server received after start + 15) into an on-time one stands, but raises `booking.needs_review` `OFFLINE_CHECK_IN_TIME` with both timestamps. |
| H3 | darktable inherited every API secret | Spawned with `{PATH, HOME, TMPDIR, LANG, LC_ALL}` only. Input refused before spawning unless its first bytes match the RAW format. Isolation proper is the worker's deployment (see below). |
| M4 | A released photographer's offline check-in could flood ops with unchecked claims | Reported only when the device time is between the floor and `released_at` and the fix passes the geofence. At most one report per assignment. |
| M5 | Concurrent sessions could overcommit storage; staged parts were never reclaimed | The capacity check reserves the outstanding bytes of every open session. Local-disk usage counts staged parts. A new hourly `media.upload-reaper` drops the staged parts of sessions idle 24 h; those files restart, verified files are untouched, and ops gets a MEDIUM alert. |
| M6 | One bad RAW stalled the whole export | A failing file is alerted and skipped for the rest of the run, and the others still export. The job then fails, so its BullMQ retries only see the failed files. Export has its own queue (`media-export`), so it can't starve the monitors. |
| M7 | Portal: no CSP; sign-out left the refresh token valid | Nonce-based CSP via `proxy.ts` (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src` set to the API origin, `frame-ancestors 'none'`) plus HSTS, nosniff, `Referrer-Policy: no-referrer`, X-Frame-Options and Permissions-Policy. New `POST /pro/auth/logout`; sign-out calls it. |
| M8 | Files trusted by extension | `completeFile` reads the stored object's first 16 bytes and checks the signature: JPEG, TIFF family, CR2, CR3, RAF, ORF, RW2, ISO-BMFF/QuickTime, MPEG-TS. On a mismatch the object is deleted, the file is reset, and the photographer gets 422 `FILE_CONTENT_MISMATCH`. |
| L1 | 100 kB JSON limit refused manifests over ~800 files | Global JSON limit 512 kB (a 3,000-file manifest is ~400 kB), set in `http-app.ts` and shared with the e2e harness. Side finding: a body-parser error was a 500; it is now 413 `PAYLOAD_TOO_LARGE` or 400 `INVALID_JSON`. |
| L2 | `__proto__`/`constructor` file ids | `ClientFileId` refuses every `Object.prototype` name. File lookups use own keys only. |
| L3 | Extension requests could be repeated without limit | A 10-minute cooldown after the client declines (not after a lapse, a calendar conflict or a repricing). At most 8 requests per assignment. |
| L5 | Approval could 500 if the price changed | The request is declined `REPRICED` and the client gets 409 `EXTENSION_REPRICED`. The client is never charged a price they were not shown. |
| L6 | `TRUST_PROXY_HOPS` silently 0; http CORS origins allowed when deployed | Staging/production must set `TRUST_PROXY_HOPS` explicitly, and CORS origins must be https. |
| L7 | Portal fell back to `http://localhost:4000` | `build:production` (`CLICKCO_DEPLOY=1`) fails without an https `NEXT_PUBLIC_API_URL`. |
| L8 | Upload checkpoints outlived sign-out | Sign-out clears this photographer's IndexedDB checkpoints (resume still works from the server). Closing the tab keeps them. |

## Decided

- **M1 — waiting does not extend the minimum duration.** Rejected as a finding. ADR-0013 D6 already
  decided this: charged waiting is the client's lateness, not shoot time. The booked hours run from
  the billing start, and the waiting charge pays for the photographer's time spent waiting. The
  reviewer read D9 as "on top of the block"; D6 is explicit.
- **M2 — the waiting charge rests on the photographer's word.** The charge stays immediate (T&C §2.6).
  It is bounded:
  - by H1: only time before the shoot starts counts;
  - by the 60-minute cap with an ops alert;
  - by one log per assignment.

  The client sees it as a line item on the booking. The balance is paid after delivery (S8), so the
  client can dispute it before paying. S8 shows a "query this charge" action on the balance screen,
  and S11 notifies the client when waiting is logged. Revisit if disputes on waiting exceed 5 % of
  waiting charges in the first month.
- **M3 — geofence trusts client GPS.** Accepted for launch; it is the same trust every booking app
  places in the device.
  - When the Pro app (S6 frontend) lands, it sends expo-location's `mocked` flag in `GeoFix` and the
    API refuses a mocked fix. Not built yet: the contract field arrives with the app.
  - An unverified check-in already alerts ops.
  - Play Integrity / App Attest attestation is a post-launch item (needs the store listings).
  - Geocoding at booking time (S11) removes most `CITY_CENTRE` fallbacks.

## Accepted, with a trigger

- **H3 isolation.** darktable runs in the API's worker process until export volume justifies a
  separate worker image. Before the first production export, that image must exist: non-root, no
  network, no app secrets, with cgroup memory/CPU limits. Owner: S12 launch checklist.
- **M9 — part state in one jsonb document.** A typical session (~2,300 parts) writes ~265 MB of WAL,
  which is tolerable at launch volume. Trigger: sessions over 10,000 parts, or WAL above 5 GB/day.
  Then add an `upload_parts` table (schema addendum + schema-guardian).
- **L4 — a released photographer can briefly lock the booking.** The ownership check is already a
  non-locking read; the lock is held for one statement and every path then refuses a non-holding
  assignment. The abandoned-offline-check-in report (M4) needs this path.
- **L6 — media throttles per IP, not per photographer.** The global throttler guard runs before
  ProGuard, so the subject is not known yet. With `TRUST_PROXY_HOPS` required, the IP is the
  photographer's own. Revisit if a venue's shared network makes several photographers hit the limit.
- **Drive adapter** (info): when it is built, escape `'` and `\` in `q` queries, and never return
  `webViewLink`/`webContentLink` to a client.
