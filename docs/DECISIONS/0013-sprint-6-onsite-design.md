# ADR-0013 — Sprint 6 design: on-site operations (check-in → check-out)

**Status:** Accepted 23 Oct 2026 (taken on Darshil's behalf; overridable)
**Sources:** DOMAIN.md §2 (ASSIGNED → EN_ROUTE → CHECKED_IN → IN_PROGRESS → CHECKED_OUT, extension rows,
ASSIGNED/EN_ROUTE → DISPATCHING no-show path, ACCESS_DENIED, UNSAFE_SITE), §4 (T0 = actual_check_out),
§5 rule 7, Invariants 2, 3, 5, 11, 12; v0.2 §6, §9; G-15, G-16, G-19, G-23; T&C §2.6, §3.6, §3.8, §6.1,
§7.2, §8.3; doc 05 §3 step 11–12, §5 `extension_rates`; schema §7 (bookings SLA anchors), §8 (assignments
check-in/out, assignment_events), booking_price_snapshots sequence 2+. Builds on ADR-0010/0011/0012.

The specs fix *what* happens on site; the numbers and edge rules below are v1 and live in
`modules/onsite/onsite.config.ts` so ops can tune them.

## D1 — Module and table ownership
New bounded context `modules/onsite` (check-in through check-out, extensions, waiting, incidents, the
no-show detector, earnings). It **owns `assignment_events`** (nobody wrote it before S6).
`assignments` stays owned by dispatch: dispatch exports `AssignmentsService`, the only writer of the
on-site columns (`check_in_*`, `check_out_*`, `declared_frame_count`, status ASSIGNED → EN_ROUTE →
ACTIVE → COMPLETED, `blocked_until` for extensions). The spatial query (`ST_Distance` to the venue) is
`dispatch/repositories/geofence.repository.ts` (apps/api/CLAUDE.md: PostGIS only there); points are
*stored* elsewhere as a bound EWKT parameter cast to geography (no spatial function). Bookings gains
on-site writes (`actual_check_in`, `actual_check_out` + `sla_t0` + `delivery_due_at`, charge snapshots
and totals) behind `BookingsService`. Lock order everywhere: **booking → assignment** (as dispatch).

## D2 — Transitions and assignment status
| Endpoint | Booking | Assignment |
|---|---|---|
| `POST /pro/assignments/:id/en-route` | ASSIGNED → EN_ROUTE | ASSIGNED → EN_ROUTE |
| `POST …/check-in` | EN_ROUTE → CHECKED_IN | → ACTIVE (check-in written) |
| `POST …/start` | CHECKED_IN → IN_PROGRESS | ACTIVE |
| `POST …/check-out` | IN_PROGRESS → CHECKED_OUT | ACTIVE → COMPLETED (check-out written) |
- En-route and check-in open at `scheduled_start − 3 h` (409 `TOO_EARLY`). DOMAIN's "T-60m" is the
  expected moment, not a gate.
- A check-in from ASSIGNED (the photographer never tapped en-route) **auto-walks** ASSIGNED → EN_ROUTE
  first in the same transaction (DOMAIN has no ASSIGNED → CHECKED_IN; both rows are logged and both
  events emitted, reason `Auto: checked in without tapping en-route`).
- Start is explicit (not automatic on check-in): CHECKED_IN is the state in which waiting is measured
  (T&C §2.6) and in which client non-attendance is reported (§3.8). Repeating en-route or start is a
  200 no-op.

## D3 — Geofence (G-15)
Distance is computed server-side, `ST_Distance(venue::geography, fix::geography)`, rounded to 0.1 m.
The venue point uses dispatch's fallback chain (ADR-0010): geocoded `venue_location` → pincode centroid
→ city centre, and records its **basis** (`VENUE` | `PINCODE_CENTROID` | `CITY_CENTRE`).
- Accuracy must be ≤ **100 m** (422 `LOCATION_TOO_INACCURATE`) — a 150 m fence is meaningless with a
  fix worse than that.
- `VENUE` basis: accepted only within **150 m** (422 `OUTSIDE_GEOFENCE`).
- Fallback bases are not the venue, so a 150 m test proves nothing; venues are geocoded in S11. Until
  then a fix within 150 m of the fallback point is *verified*; beyond it, up to **3 km** of a centroid or
  **30 km** of a city centre, it is accepted **unverified**: an `GEOFENCE_UNVERIFIED` assignment event
  and `assignment.geofence_unverified` (→ `ops.alert`). Further away is 422 `OUTSIDE_GEOFENCE`.
  **Launch note:** billing-proof check-ins need geocoded venues (S11); every un-geocoded booking will
  alert ops.
- Basis, verified flag, distance and accuracy go in the CHECKED_IN / CHECKED_OUT `booking_status_events`
  metadata (append-only) and the event payloads; check-in distance also in `assignments.check_in_distance_m`
  (there is no check-out distance column — metadata only; no schema change in S6).
- Check-out is geofenced exactly like check-in. Incident reports are never geofence-gated (safety first).

## D4 — Immutability and replays (G-15, G-19)
`check_in_*` / `check_out_*` are written once (`UPDATE … WHERE check_in_at IS NULL`). A repeat whose
`deviceTs` equals the stored `*_device_ts` (ms) is the same event replayed by the offline queue: **200,
no write**, the recorded values returned with `replayed: true`. Any other repeat is 409
`CHECK_IN_ALREADY_RECORDED` / `CHECK_OUT_ALREADY_RECORDED`. The same rule dedupes every
photographer-originated assignment event that carries a `deviceTs` (waiting, incidents, extension
requests): same `(assignment, kind, device_ts)` ⇒ the stored result. HTTP `Idempotency-Key` (10 min on
`/pro/*`, ADR-0012) covers network retries; the deviceTs rule covers replays hours later. The Pro app must
send `deviceTs` on every on-site event.

## D5 — Offline timestamps (G-19)
`deviceTs` is stored in `*_device_ts` whenever sent. The **authoritative** time is the device time only
when `offline = true` **and** `blocked_from ≤ deviceTs ≤ now + 2 min` (clamped to now) **and**
`now − deviceTs ≤ 6 h` (and, for check-out, after the check-in); otherwise the server receive time. A
late-synced offline check-in arriving after the no-show escalation (D11) finds the assignment ABANDONED:
409 `ASSIGNMENT_NOT_ACTIVE`, plus `assignment.offline_check_in_after_no_show` (→ `ops.alert`) so ops can
reverse the penalty by hand (S9).

## D6 — Billing clock and minimum duration
DOMAIN §2 says check-in starts the billing clock; T&C §2.6 says the clock starts at the scheduled start,
"not at your arrival". Both hold with **billing start = max(check_in_at, scheduled_start)**: an early
photographer does not shorten the shoot; a late one is not billed for time they were absent. Check-out
needs `now ≥ billing start + booked hours + approved extension hours` (422 `MINIMUM_DURATION_NOT_MET`,
with `earliestCheckOutAt`). Logged waiting does not extend it (the waiting charge pays for the held
time). Early release by the client is not in S6 (S9/S11).

## D7 — Check-out and SLA anchors (Invariant 2)
`actual_check_out` = the authoritative check-out time; `sla_t0` is set **in the same statement from the
same value**; `delivery_due_at = sla_t0 + 48 h`, or **+24 h** when the booking has the `RUSH_24H` add-on
(doc 05 §5). `booking.checked_out` carries `assignment_id, check_out_location, sla_t0,
declared_frame_count` (DOMAIN §3) plus `delivery_due_at`. Arming `sla_clocks` and the balance invoice
subscribe to that event in S8. An extension request still pending when the shoot ends (check-out,
confirmed incident) is declined (`SHOOT_ENDED`, or `EXPIRED` if it had already lapsed).

## D8 — Extensions (G-16, T&C §6.1)
- `POST /pro/assignments/:id/extensions {hours: 1}` while the booking is IN_PROGRESS; one open request at
  a time (409 `EXTENSION_PENDING`); at most **4 approved** per booking (409 `EXTENSION_LIMIT`).
- Price: the existing pure `priceExtension` (base hourly × category uplift, nothing else) on the
  booking's **own** ruleset (`loadById`, no catalogue filter — Invariant 17) × 1 h; GST via the engine's
  `applyGst` (exclusive/inclusive per the ruleset flag) with the place of supply of snapshot 1.
- A request **expires after 10 min**: a BullMQ `onsite.extension-expiry` job records
  `EXTENSION_DECLINED` (SYSTEM, `EXPIRED`); approval also checks expiry itself, so a lost job never lets
  a stale request through and never blocks a new one.
- `POST /bookings/:id/extensions/:eventId/approve|decline` — owner only (404 otherwise), `@Idempotent`,
  booking IN_PROGRESS. Approve, in one transaction: lock booking → lock assignment →
  `blocked_until + 60 min` under a savepoint (the `EXCLUDE` constraint refusing it ⇒ the request is
  declined (SYSTEM, `CONFLICT`), that commits, then 409 `EXTENSION_CONFLICT`) → `EXTENSION_APPROVED` →
  snapshot **sequence n+1 holding only the delta** (the booking's ruleset, neutral emergency/surge/
  night/weekend, `hours = 1.0`, `breakdown.kind = EXTENSION`) → `bookings.total_paise` and
  `balance_paise` += the extension total (advance unchanged, so advance + balance = total still holds) →
  `assignment.extension_approved {assignment_id, minutes, amount_paise, new_snapshot_sequence}`.
  Snapshots stay immutable (Invariant 3); the booking total is the sum of all sequences.
- `assignment_events` has no parent column: requests and resolutions are written under the booking
  lock with at most one open request, so a resolution always answers the latest open request. The
  snapshot breakdown records `requestEventId`.
- Payout on the extension: the tier payout share × the extension net (doc 05 step 12 applied to the
  line), stored as that snapshot's `expected_payout_paise`.

## D9 — Waiting time (T&C §2.6)
`POST …/waiting {minutes, note, lat, lng}` while CHECKED_IN or IN_PROGRESS, **once per assignment**
(409 `WAITING_ALREADY_LOGGED`), minutes ≤ the minutes elapsed since the billing start (422
`WAITING_EXCEEDS_ELAPSED`). Charging uses at most **60 min** (more ⇒ `assignment.waiting_capped` →
ops: past 60 min T&C §3.8 non-attendance applies, D12). Chargeable = `max(0, capped − grace)` with the
ruleset's grace (15). Amount = one half-up rounding of `waiting_hourly × uplift × chargeable / (10000 ×
60)`, GST as extensions; a WAITING delta snapshot (`hours = 0.0`, minutes in the breakdown) and the
total/balance increase are written at log time (no client approval: §2.6 makes waiting chargeable). The
client sees it in `BookingDetail.charges`; photographer notes are never shown to the client.
**Spec finding (SA-15, for the T&C owner):** T&C §2.6 says "at the hourly extension rate"; doc 05 §5,
the schema and DOMAIN rule 7 say 60% of it. We charge 60% (the lower, client-favourable figure) — fix
the T&C wording. The T&C is also silent on whether waiting extends the shoot; here it does not (D6).

## D10 — Access denied and unsafe site (T&C §7.2, §8.3)
`POST …/access-denied` and `POST …/unsafe {note, lat, lng}` while CHECKED_IN or IN_PROGRESS write
`ACCESS_DENIED_REPORTED` / `UNSAFE_REPORTED` and emit `assignment.access_denied_reported` /
`assignment.unsafe_reported` (→ `ops.alert`; unsafe is CRITICAL). The booking only moves when staff
confirm: the staff panel is S9, so for now **`POST /dev/assignments/:id/confirm-incident {kind}`**
(DevToolsModule, development only) needs a matching report and moves the booking to ACCESS_DENIED
(from CHECKED_IN/IN_PROGRESS) or UNSAFE_SITE (from IN_PROGRESS; a CHECKED_IN booking walks to
IN_PROGRESS first, actor STAFF). The assignment becomes COMPLETED; no `sla_t0` (there was no check-out).
Money (50% charge, partial charge) is `booking.needs_review` `ACCESS_DENIED_CHARGE_50` /
`UNSAFE_SITE_PARTIAL_CHARGE` for S8. **Gap recorded:** UNSAFE_SITE is terminal, yet §8.3 delivers the
files captured so far — S7/S8 must amend DOMAIN §2 before that delivery exists.

## D11 — No-show detector (v0.2 §9, T&C §3.6)
- `booking.assigned` arms `onsite.no-show-check` for that assignment at `scheduled_start + 15 min`; for
  a replacement (`is_replacement`) at `max(start + 15 min, accepted_at + 90 min)` — a replacement found
  after the start needs travel time (90 min = the calendar travel buffer).
- **Alert** (still no check-in): `NO_SHOW_SUSPECTED` assignment event (once) and
  `booking.no_show_suspected` → `ops.alert` CRITICAL; S11 sends the SMS/call and tells the client.
- **Escalate** at `max(start + 20 min, alert + 5 min)` if still no check-in:
  `RedispatchService.redispatch(…, 'NO_SHOW')` — assignment ABANDONED, the existing penalty ladder,
  ASSIGNED/EN_ROUTE → DISPATCHING (`booking.redispatching`, `NO_SHOW`), emergency broadcast at the
  base-share incentive (ADR-0012 D5/D6).
- A job that fires early re-arms; the repeatable `onsite.sweep` (60 s) re-runs the check for every
  ASSIGNED/EN_ROUTE booking 15+ min past its start (lost jobs). Every step re-checks under the booking
  lock and is a no-op once checked in or ended.
- **Late replacement** (§3.6b): a replacement checking in after `start + 15 min` emits
  `booking.late_replacement` and `booking.needs_review` `LATE_REPLACEMENT_CREDIT_25`; issuing the 25%
  credit is S8. The verified-emergency penalty waiver is S9.

## D12 — Client non-attendance (T&C §3.8)
`POST …/client-absent {note, lat, lng, accuracyM, deviceTs?, offline?}` — booking CHECKED_IN (the shoot
never started), `≥ 60 min after the billing start` (= the scheduled start for an on-time photographer,
exactly §3.8; a late photographer must give the client 60 minutes of their own presence) — else 409
`TOO_EARLY` — and geofenced like a check-out. The
booking is treated as completed: CHECKED_IN → IN_PROGRESS (SYSTEM) → CHECKED_OUT (PHOTOGRAPHER) with
the check-out written, `declared_frame_count = 0` and the SLA anchors of D7 (it *is* the check-out, so
Invariant 2 holds); no minimum-duration check. `CLIENT_ABSENT_REPORTED`, `booking.needs_review`
`CLIENT_NON_ATTENDANCE` (no refund; the balance stays due — S8) and `ops.alert`. `body.accuracyM` is
required because this ends the booking as billed (financial-grade, like check-out).

## D13 — Earnings (G-23)
`GET /pro/earnings`: **expected** gross payouts (before TDS and penalty deductions, which are S8) for
the photographer's assignments with a check-out: the accepted offer's payout (so a no-show incentive
counts) + the `expected_payout_paise` of the booking's extension/waiting snapshots. Totals for today, this
ISO week (Mon–Sun) and this month in IST by check-out time; `pendingPayoutPaise` = all of it (no payout
batches exist until S8); the last 50 jobs. Incident-ended bookings are excluded until S8 decides them.
`GET /pro/assignments/:id`: own assignment in ASSIGNED/EN_ROUTE/ACTIVE/COMPLETED with check-in/out,
billing start, earliest check-out and the event timeline; the address is hidden (null) once COMPLETED;
RELEASED/ABANDONED are 404 like someone else's.

## D14 — Client view
`BookingDetail` gains optional `pendingExtensions` (price, expiry) and `charges` (extension and waiting
snapshots with their amounts) — optional so existing consumers keep parsing.

## D15 — Error codes (all `{code, message, details?}`)
404 `ASSIGNMENT_NOT_FOUND` (missing or someone else's), `BOOKING_NOT_FOUND`, `EXTENSION_NOT_FOUND`;
409 `ASSIGNMENT_NOT_ACTIVE`, `WRONG_STAGE`, `TOO_EARLY` (`details.opensAt`), `CHECK_IN_ALREADY_RECORDED`,
`CHECK_OUT_ALREADY_RECORDED`, `EXTENSION_PENDING`, `EXTENSION_LIMIT`, `EXTENSION_EXPIRED`,
`EXTENSION_NOT_OPEN`, `EXTENSION_CONFLICT`, `WAITING_ALREADY_LOGGED`, `NO_INCIDENT_REPORTED`;
422 `OUTSIDE_GEOFENCE` (`details.distanceM`, `limitM`), `LOCATION_TOO_INACCURATE`,
`MINIMUM_DURATION_NOT_MET` (`details.earliestCheckOutAt`), `WAITING_EXCEEDS_ELAPSED`.

## D16 — Events and ops alerts
New outbox events (aggregate `booking`): `assignment.extension_requested | _approved | _declined`,
`assignment.waiting_logged | _waiting_capped`, `assignment.access_denied_reported`,
`assignment.unsafe_reported`, `assignment.client_absent_reported`, `assignment.geofence_unverified`,
`assignment.offline_check_in_after_no_show`, `booking.no_show_suspected`, `booking.late_replacement`,
`booking.needs_review` (the S8 money-review queue for on-site effects). `OpsAlertsSubscriber` records an
`ops.alert` for the no-show, incident, waiting-cap, geofence, offline-after-no-show and needs-review
events. New `assignment_events.kind` values: `NO_SHOW_SUSPECTED`, `CLIENT_ABSENT_REPORTED`,
`GEOFENCE_UNVERIFIED` (the column is free text; the schema comment lists the S5 set).

## D17 — Dev console
`GET /dev/assignments/:id` (assignment, check-in/out, booking status, events) and the incident confirm
above, in DevToolsModule only.

## DOMAIN.md amendments (with this ADR)
§2 rows CHECKED_IN (billing start = max(check-in, scheduled start)) and CHECKED_OUT (also reached on
client non-attendance ≥ 60 min, without the minimum duration) carry the D6/D12 wording.

## Deferred
S7: upload after check-out, unsafe-site delivery. S8: sla_clocks arming, balance invoice incl.
extensions/waiting, extension/waiting collection, 25% late-replacement credit, access-denied/unsafe
charges, payouts/TDS. S9: staff confirm of incidents, penalty waivers, manual check-in override,
reversing an offline-after-no-show. S11: venue geocoding (makes geofences verified), SMS/call/WhatsApp
for no-shows and extension approvals, live location.
