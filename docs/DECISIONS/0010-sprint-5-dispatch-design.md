# ADR-0010 — Sprint 5 design: dispatch engine

**Status:** Accepted 23 Oct 2026 (taken on Darshil's behalf; overridable)
**Sources:** v0.2 §8 (emergency), §9 (no-show), G-28 (double booking); DOMAIN.md §2 (CONFIRMED → DISPATCHING → ASSIGNED),
Invariant 8; schema §6 (photographers, categories, availability, blocks, metrics), §8 (dispatch_rounds,
dispatch_attempts, assignments). The specs fix the mechanics but not the numbers; the numbers below are v1 and
live in one config object so ops can tune them.

## Trigger
`booking.confirmed` in the outbox → dispatch starts (CONFIRMED → DISPATCHING). Sprint 5 adds the outbox publisher:
a BullMQ repeatable job polls `domain_events WHERE published_at IS NULL` (batch 100, `FOR UPDATE SKIP LOCKED`),
routes each event to its subscribers, sets `published_at`. At-least-once; subscribers are idempotent.

## Eligibility (hard filters, one PostGIS query in `dispatch/repositories/`)
ACTIVE · same city · `max_tier ≥ booking tier` · certified for the category at ≥ tier when the category
requires certification at that tier (`photographer_categories`, not revoked) · within `service_radius_km` of the
venue (`ST_DWithin`) · no overlapping assignment or block in `[start − 90 min, end + 90 min]` · availability
window covers the IST weekday and times (no availability rows = always available) · `accepts_emergency` for
emergency bands · DRONE add-on ⇒ approved `DRONE_RPC` and `DRONE_UIN` documents · not already offered this booking.
Venue point: `bookings.venue_location`, else the pincode centroid, else the city centre (geocoding is S11).

## Ranking (score 0–1, stored in `dispatch_attempts.rank_score`)
`0.35 × proximity + 0.25 × rating + 0.20 × acceptance rate + 0.15 × on-time upload − 0.05 × min(no-shows, 3)/3`,
where proximity = `1 − distance / radius`; missing metrics count as 0.8 (new photographers are not buried).

## Cascade (standard bands NONE, NEXT_DAY)
| Wave | Radius | Offers to | Window |
|---|---|---|---|
| 1 | 8 km | top 3 | 120 s |
| 2 | 15 km | next 5 | 120 s |
| 3 | 25 km | next 10 | 180 s |
| 4 | city-wide | all remaining | 300 s |
A wave's expiry is a delayed BullMQ job; the job is a no-op if the booking is already assigned. Exhausted ⇒
`dispatch.exhausted` event, booking stays DISPATCHING for the ops desk.

## Emergency (SAME_DAY, HOURS_3_8, HOURS_UNDER_3) — v0.2 §8
One broadcast wave to every eligible opted-in photographer, 10-minute window, first accept wins.
HOURS_UNDER_3: an `emergency-auto-refund` delayed job at `scheduled_start − 90 min` cancels the booking and
releases the authorisation if nobody has accepted (`booking.cancelled_pro` with reason `UNFILLED_EMERGENCY`).

## Accept (first accept wins, no double booking)
1. Redis `SET dispatch:booking:{id} {attemptId} NX PX 15000` — losers get 409 `ALREADY_TAKEN` instantly.
2. One transaction: attempt → ACCEPTED (must be PENDING and unexpired); other PENDING attempts → LOST_RACE;
   round → FILLED; INSERT assignment with `blocked_from/until = start − 90 min / end + 90 min` — the
   `EXCLUDE USING gist` constraint is the guarantee against double booking (violation ⇒ 409 `SLOT_CONFLICT`);
   booking DISPATCHING → ASSIGNED (+ status event + outbox).
3. Auth-only payment (HOURS_UNDER_3): capture after commit via the payments service; on capture failure the
   assignment is released and the booking is cancelled with a full release.

## Photographer access
`PRO_LOGIN` OTP purpose → session subject `PHOTOGRAPHER` (only ACTIVE photographers). Endpoints:
`GET /pro/offers` (pending, unexpired, with payout and approximate area only — exact address after accept,
client shown as first name + initial), `POST /pro/offers/:attemptId/accept`, `POST /pro/offers/:attemptId/decline`.
Payout shown = snapshot `expected_payout_paise`.

## Dev data
`db:seed:dev` (development only): verified demo photographers in all three cities with categories, gear,
metrics and base locations, so the console's dispatch desk can run a full cascade.

## Addendum (23 Oct 2026, with ADR-0012)
- **Wave numbers are booking-wide.** `dispatch_rounds` is unique on `(booking_id, wave)`, so a
  re-dispatch continues the numbering (a replacement run after wave 2 starts at wave 3). A *run* is
  the rounds after the last `FILLED` one; "not already offered this booking" means **not offered in
  the current run** — a photographer who declined the first search may be offered the replacement,
  except one whose assignment on this booking was released or abandoned.
- **Radius sentinel.** A city-wide wave (cascade wave 4, every broadcast) records `radius_km = 100`
  (NOT NULL column); each photographer's own `service_radius_km` is the real limit.
- **Empty waves** are recorded (`candidate_count = 0`) and closed at once; the cascade moves straight on.
- **Emergency auto-refund generalised** by ADR-0012 D1: every band is auto-cancelled at
  `scheduled_start − auto_refund_minutes_before` (90 at launch) → `CANCELLED_PRO` reason `UNFILLED`
  (was `UNFILLED_EMERGENCY`, HOURS_UNDER_3 only). The job is `dispatch.deadline`.
- **Accept step 3** runs from the `booking.assigned` outbox event (crash-safe), with the outcomes,
  lease and lock order of ADR-0012 D3/D4. A declined capture cancels to `CANCELLED_CLIENT`.
- **No-show incentive** applies to the base-service payout share only (ADR-0012 D5).
- **Exhaustion** of a replacement run ends the booking (ADR-0012 D6).
