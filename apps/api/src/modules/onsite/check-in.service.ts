import type {
  CheckInResponse,
  EnRouteResponse,
  GeoFix,
  GeofenceBasis,
  StartShootResponse,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentsService } from '../dispatch/assignments.service';
import type { OnsiteAssignment } from '../dispatch/dispatch.types';
import { GeofenceGate, type GeofenceResult, recordedFix } from './geofence-gate';
import { assignmentNotActive, conflict, wrongStage } from './http-errors';
import { ONSITE_CONFIG } from './onsite.config';
import type { Tx } from './onsite.types';
import type { OnsiteContext } from './onsite-context';
import { OnsiteContextLoader } from './onsite-context';
import { emitOnce, needsReview } from './onsite-outbox';
import { decideGeofence } from './rules/geofence';
import { deviceTimeHidLateness, isLateReplacement } from './rules/no-show';
import { authoritativeTime, billingStartsAt, deviceTimeFloor, onsiteOpensAt } from './rules/timing';
import { toCheckInResponse } from './views';

const PRE_ARRIVAL = ['ASSIGNED', 'EN_ROUTE'] as const;
const isPreArrival = (s: string): boolean => (PRE_ARRIVAL as readonly string[]).includes(s);
const sameInstant = (a: Date | null, b: string | undefined): boolean =>
  a !== null && b !== undefined && a.getTime() === new Date(b).getTime();

type CheckInOutcome =
  | { readonly kind: 'DONE'; readonly response: CheckInResponse }
  | { readonly kind: 'AFTER_NO_SHOW' };

/**
 * ASSIGNED → EN_ROUTE → CHECKED_IN → IN_PROGRESS (ADR-0013 D2–D6). Every write is in one
 * transaction holding booking → assignment locks; the check-in is written once (G-15).
 */
@Injectable()
export class CheckInService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(GeofenceGate) private readonly geofence: GeofenceGate,
  ) {}

  async enRoute(photographerId: string, assignmentId: string): Promise<EnRouteResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      const response: EnRouteResponse = {
        assignmentId,
        bookingId: ctx.booking.bookingId,
        bookingStatus: 'EN_ROUTE',
      };
      if (ctx.booking.status === 'EN_ROUTE' && ctx.assignment.status === 'EN_ROUTE')
        return response;
      assertHolding(ctx.assignment);
      if (ctx.booking.status !== 'ASSIGNED') throw wrongStage(ctx.booking.status);
      assertOpen(ctx, now);
      await this.walkEnRoute(tx, ctx, now, 'Photographer is on the way');
      return response;
    });
  }

  /**
   * Geofenced check-in. A check-in straight from ASSIGNED walks EN_ROUTE first. A replay of the
   * same offline event (same deviceTs) returns the recorded check-in without writing (D4).
   */
  async checkIn(
    photographerId: string,
    assignmentId: string,
    fix: GeoFix,
  ): Promise<CheckInResponse> {
    const now = this.clock();
    const outcome = await this.sql.begin((tx) =>
      this.checkInInTx(tx, photographerId, assignmentId, fix, now),
    );
    if (outcome.kind === 'AFTER_NO_SHOW') throw assignmentNotActive();
    return outcome.response;
  }

  async start(photographerId: string, assignmentId: string): Promise<StartShootResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      const response: StartShootResponse = {
        assignmentId,
        bookingId: ctx.booking.bookingId,
        bookingStatus: 'IN_PROGRESS',
      };
      if (ctx.booking.status === 'IN_PROGRESS' && ctx.assignment.status === 'ACTIVE')
        return response;
      if (ctx.assignment.status !== 'ACTIVE') throw assignmentNotActive();
      if (ctx.booking.status !== 'CHECKED_IN') throw wrongStage(ctx.booking.status);
      await this.bookings.transition(tx, {
        bookingId: ctx.booking.bookingId,
        to: 'IN_PROGRESS',
        actor: { kind: 'PHOTOGRAPHER', id: photographerId },
        occurredAt: now,
        reason: 'Shoot started',
        payload: { assignment_id: assignmentId },
      });
      return response;
    });
  }

  private async checkInInTx(
    tx: Tx,
    photographerId: string,
    assignmentId: string,
    fix: GeoFix,
    now: Date,
  ): Promise<CheckInOutcome> {
    const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
    const a = ctx.assignment;
    if (a.checkInAt) {
      if (!sameInstant(a.checkInDeviceTs, fix.deviceTs)) {
        throw conflict('CHECK_IN_ALREADY_RECORDED', 'You have already checked in for this shoot');
      }
      return {
        kind: 'DONE',
        response: replayedCheckIn(ctx, await this.assignments.venueBasis(ctx.booking)),
      };
    }
    if (a.status === 'ABANDONED' && fix.offline) {
      await this.reportLateOfflineCheckIn(tx, ctx, fix, now);
      return { kind: 'AFTER_NO_SHOW' };
    }
    assertHolding(a);
    if (!isPreArrival(ctx.booking.status)) throw wrongStage(ctx.booking.status);
    assertOpen(ctx, now);
    const fence = await this.geofence.check(tx, ctx, fix);
    const time = authoritativeTime({
      serverNow: now,
      deviceTs: fix.deviceTs ? new Date(fix.deviceTs) : undefined,
      offline: fix.offline,
      windowStart: deviceTimeFloor(a, ctx.booking.scheduledStart),
      maxAgeMinutes: ONSITE_CONFIG.offline.maxCheckInAgeMinutes,
    });
    const recorded = recordedFix(fix, time.at);
    if (ctx.booking.status === 'ASSIGNED') {
      await this.walkEnRoute(tx, ctx, time.at, 'Auto: checked in without tapping en-route');
    }
    if (!(await this.assignments.recordCheckIn(tx, a.id, recorded, fence.distanceM))) {
      throw conflict('CHECK_IN_ALREADY_RECORDED', 'You have already checked in for this shoot');
    }
    await this.bookings.recordCheckIn(tx, ctx.booking.bookingId, time.at);
    await this.bookings.transition(tx, {
      bookingId: ctx.booking.bookingId,
      to: 'CHECKED_IN',
      actor: { kind: 'PHOTOGRAPHER', id: photographerId },
      occurredAt: time.at,
      reason: 'Geofenced check-in',
      metadata: fenceMetadata(a.id, fence, fix, time.usedDeviceTime),
      payload: {
        assignment_id: a.id,
        check_in_location: { lat: fix.lat, lng: fix.lng },
        check_in_accuracy_m: fix.accuracyM,
        check_in_offline: fix.offline,
        distance_m: fence.distanceM,
        geofence_basis: fence.basis,
        geofence_verified: fence.verified,
      },
    });
    await this.geofence.flagUnverified(tx, ctx, 'CHECK_IN', fence, recorded);
    await this.flagLateReplacement(tx, ctx, time.at);
    await this.flagDeviceTimeLateness(tx, ctx, time.at, now);
    return {
      kind: 'DONE',
      response: toCheckInResponse({
        assignmentId: a.id,
        bookingId: ctx.booking.bookingId,
        checkedInAt: time.at,
        distanceM: fence.distanceM,
        accuracyM: fix.accuracyM,
        basis: fence.basis,
        verified: fence.verified,
        offline: fix.offline,
        billingStartsAt: billingStartsAt(time.at, ctx.booking.scheduledStart),
        replayed: false,
      }),
    };
  }

  private async walkEnRoute(tx: Tx, ctx: OnsiteContext, at: Date, reason: string): Promise<void> {
    await this.assignments.markEnRoute(tx, ctx.assignment.id);
    await this.bookings.transition(tx, {
      bookingId: ctx.booking.bookingId,
      to: 'EN_ROUTE',
      actor: { kind: 'PHOTOGRAPHER', id: ctx.assignment.photographerId },
      occurredAt: at,
      reason,
      payload: { assignment_id: ctx.assignment.id },
    });
  }

  /** T&C §3.6b: the 25% credit for a late replacement is S8's; flag it now (ADR-0013 D11). */
  private async flagLateReplacement(tx: Tx, ctx: OnsiteContext, checkInAt: Date): Promise<void> {
    const minutesLate = isLateReplacement({
      isReplacement: ctx.assignment.isReplacement,
      checkInAt,
      scheduledStart: ctx.booking.scheduledStart,
    });
    if (minutesLate === null) return;
    const details = {
      assignment_id: ctx.assignment.id,
      replaced_assignment_id: ctx.assignment.replacedAssignmentId,
      minutes_late: minutesLate,
      credit_bps: ONSITE_CONFIG.lateReplacementCreditBps,
      booking_total_paise: fromPaiseBigint(ctx.booking.totalPaise),
    };
    await emitOnce(
      tx,
      'booking.late_replacement',
      ctx.booking.bookingId,
      checkInAt,
      ctx.assignment.id,
      details,
    );
    await needsReview(tx, ctx.booking.bookingId, 'LATE_REPLACEMENT_CREDIT_25', checkInAt, details);
  }

  /** Security review H2: the device clock made a late arrival on time — ops checks it. */
  private async flagDeviceTimeLateness(
    tx: Tx,
    ctx: OnsiteContext,
    recordedAt: Date,
    serverNow: Date,
  ): Promise<void> {
    const { scheduledStart } = ctx.booking;
    if (!deviceTimeHidLateness({ recordedAt, serverNow, scheduledStart })) return;
    await needsReview(tx, ctx.booking.bookingId, 'OFFLINE_CHECK_IN_TIME', recordedAt, {
      assignment_id: ctx.assignment.id,
      photographer_id: ctx.assignment.photographerId,
      is_replacement: ctx.assignment.isReplacement,
      device_check_in_at: recordedAt.toISOString(),
      server_received_at: serverNow.toISOString(),
      scheduled_start: scheduledStart.toISOString(),
    });
  }

  /**
   * D5: the photographer was there, but the no-show escalation already ran — ops reverses it.
   * Security review M4: only a plausible claim reaches ops (a device time between the floor and
   * the release, a fix that passes the fence), and at most one per assignment.
   */
  private async reportLateOfflineCheckIn(
    tx: Tx,
    ctx: OnsiteContext,
    fix: GeoFix,
    now: Date,
  ): Promise<void> {
    const a = ctx.assignment;
    // A mock-location fix proves nothing: never let it prompt ops to reverse a penalty (ADR-0024 D4).
    if (fix.mocked) return;
    const deviceTs = fix.deviceTs ? new Date(fix.deviceTs) : null;
    if (!deviceTs || !a.releasedAt || deviceTs > a.releasedAt) return;
    const time = authoritativeTime({
      serverNow: now,
      deviceTs,
      offline: true,
      windowStart: deviceTimeFloor(a, ctx.booking.scheduledStart),
    });
    if (!time.usedDeviceTime) return;
    const { distanceM, basis } = await this.assignments.measure(tx, ctx.booking, fix.lat, fix.lng);
    const decision = decideGeofence({ distanceM, accuracyM: fix.accuracyM, basis });
    if (decision.kind !== 'ACCEPTED') return;
    await emitOnce(
      tx,
      'assignment.offline_check_in_after_no_show',
      ctx.booking.bookingId,
      now,
      a.id,
      {
        assignment_id: a.id,
        photographer_id: a.photographerId,
        device_ts: deviceTs.toISOString(),
        released_at: a.releasedAt.toISOString(),
        check_in_location: { lat: fix.lat, lng: fix.lng },
        accuracy_m: fix.accuracyM,
        distance_m: distanceM,
        geofence_basis: basis,
        geofence_verified: decision.verified,
      },
    );
  }
}

function assertHolding(a: OnsiteAssignment): void {
  if (!isPreArrival(a.status)) throw assignmentNotActive();
}

function assertOpen(ctx: OnsiteContext, now: Date): void {
  const opensAt = onsiteOpensAt(ctx.booking.scheduledStart);
  if (now < opensAt) {
    throw conflict('TOO_EARLY', 'This opens 3 hours before the shoot', {
      opensAt: opensAt.toISOString(),
    });
  }
}

export function fenceMetadata(
  assignmentId: string,
  fence: GeofenceResult,
  fix: GeoFix,
  usedDeviceTime: boolean,
) {
  return {
    assignment_id: assignmentId,
    geofence_basis: fence.basis,
    geofence_verified: fence.verified,
    distance_m: fence.distanceM,
    accuracy_m: fix.accuracyM,
    offline: fix.offline,
    device_ts: fix.deviceTs ?? null,
    device_time_used: usedDeviceTime,
  };
}

/**
 * The recorded check-in, re-shown for an offline replay. The basis is not a column (it is in the
 * status-event metadata): it is re-resolved, which differs only if the venue was geocoded since.
 */
function replayedCheckIn(ctx: OnsiteContext, basis: GeofenceBasis): CheckInResponse {
  const a = ctx.assignment;
  if (!a.checkInAt) throw new Error('replayedCheckIn: no check-in recorded');
  return toCheckInResponse({
    assignmentId: a.id,
    bookingId: ctx.booking.bookingId,
    checkedInAt: a.checkInAt,
    distanceM: a.checkInDistanceM ?? 0,
    accuracyM: a.checkInAccuracyM ?? ONSITE_CONFIG.geofence.maxAccuracyM,
    basis,
    verified: (a.checkInDistanceM ?? Number.POSITIVE_INFINITY) <= ONSITE_CONFIG.geofence.radiusM,
    offline: a.checkInOffline,
    billingStartsAt: billingStartsAt(a.checkInAt, ctx.booking.scheduledStart),
    replayed: true,
  });
}
