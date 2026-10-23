import type { CheckOutResponse, ClientAbsentResponse, GeoFix } from '@clickco/contracts';
import { ClientAbsentResponse as ClientAbsentResponseSchema } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { AssignmentsService } from '../dispatch/assignments.service';
import { fenceMetadata } from './check-in.service';
import { ExtensionRecords } from './extension-records';
import { GeofenceGate, type GeofenceResult, recordedFix } from './geofence-gate';
import { assignmentNotActive, conflict, unprocessable, wrongStage } from './http-errors';
import { ONSITE_CONFIG } from './onsite.config';
import type { Tx } from './onsite.types';
import { type OnsiteContext, OnsiteContextLoader } from './onsite-context';
import { emit, needsReview } from './onsite-outbox';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import {
  authoritativeTime,
  billingStartsAt,
  clientAbsentOpensAt,
  deliveryDueAt,
  earliestCheckOutAt,
} from './rules/timing';
import { type CheckOutView, checkOutJson, toCheckOutResponse } from './views';

export type CheckOutInput = GeoFix & { readonly declaredFrameCount: number };
export type ClientAbsentInput = GeoFix & { readonly note: string };

const sameInstant = (a: Date | null, b: string | undefined): boolean =>
  a !== null && b !== undefined && a.getTime() === new Date(b).getTime();

interface Finish {
  readonly fix: GeoFix;
  readonly at: Date;
  readonly usedDeviceTime: boolean;
  readonly fence: GeofenceResult;
  readonly frames: number;
  readonly clientAbsent: boolean;
}

/**
 * IN_PROGRESS → CHECKED_OUT (ADR-0013 D6/D7) and T&C §3.8 client non-attendance (D12). The
 * check-out is written once; SLA T0 is the check-out and nothing else (Invariant 2).
 */
@Injectable()
export class CheckOutService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(OnsiteContextLoader) private readonly contexts: OnsiteContextLoader,
    @Inject(GeofenceGate) private readonly geofence: GeofenceGate,
    @Inject(ExtensionRecords) private readonly extensions: ExtensionRecords,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  async checkOut(
    photographerId: string,
    assignmentId: string,
    body: CheckOutInput,
  ): Promise<CheckOutResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      const replay = await this.replay(tx, ctx, body);
      if (replay) return toCheckOutResponse(replay);
      const a = ctx.assignment;
      if (a.status !== 'ACTIVE' || !a.checkInAt) throw assignmentNotActive();
      if (ctx.booking.status !== 'IN_PROGRESS') throw wrongStage(ctx.booking.status);
      const fence = await this.geofence.check(tx, ctx, body);
      const time = this.timeOf(ctx, body, now);
      const { ledger } = await this.extensions.ledger(tx, a.id, now);
      const earliest = earliestCheckOutAt(
        billingStartsAt(a.checkInAt, ctx.booking.scheduledStart),
        ctx.booking.scheduledHours,
        ledger.approvedCount,
      );
      if (time.at < earliest) {
        throw unprocessable('MINIMUM_DURATION_NOT_MET', 'The booked time is not over yet', {
          earliestCheckOutAt: earliest.toISOString(),
        });
      }
      await this.extensions.closeUnresolved(tx, ctx, SYSTEM_ACTOR, time.at);
      const view = await this.finish(tx, ctx, {
        fix: body,
        at: time.at,
        usedDeviceTime: time.usedDeviceTime,
        fence,
        frames: body.declaredFrameCount,
        clientAbsent: false,
      });
      return toCheckOutResponse(view);
    });
  }

  /**
   * T&C §3.8: nobody at the venue 60 min after the start (or after a late photographer arrived).
   * The booking is treated as completed: CHECKED_IN → IN_PROGRESS → CHECKED_OUT, frames 0.
   */
  async clientAbsent(
    photographerId: string,
    assignmentId: string,
    body: ClientAbsentInput,
  ): Promise<ClientAbsentResponse> {
    const now = this.clock();
    return this.sql.begin(async (tx) => {
      const ctx = await this.contexts.forPhotographer(tx, photographerId, assignmentId);
      const replay = await this.replay(tx, ctx, body);
      if (replay) {
        const reported = await this.events.firstOfKind(tx, assignmentId, 'CLIENT_ABSENT_REPORTED');
        if (!reported) throw conflict('CHECK_OUT_ALREADY_RECORDED', 'You have already checked out');
        return ClientAbsentResponseSchema.parse({ ...checkOutJson(replay), eventId: reported.id });
      }
      const a = ctx.assignment;
      if (a.status !== 'ACTIVE' || !a.checkInAt) throw assignmentNotActive();
      if (ctx.booking.status !== 'CHECKED_IN') throw wrongStage(ctx.booking.status);
      const opensAt = clientAbsentOpensAt(billingStartsAt(a.checkInAt, ctx.booking.scheduledStart));
      const fence = await this.geofence.check(tx, ctx, body);
      const time = this.timeOf(ctx, body, now);
      if (time.at < opensAt) {
        throw conflict(
          'TOO_EARLY',
          'Wait 60 minutes from the start before reporting the client absent',
          {
            opensAt: opensAt.toISOString(),
          },
        );
      }
      const reported = await this.events.insert(tx, {
        assignmentId: a.id,
        bookingId: ctx.booking.bookingId,
        kind: 'CLIENT_ABSENT_REPORTED',
        note: body.note,
        location: recordedFix(body, time.at).location,
        actorKind: 'PHOTOGRAPHER',
        actorId: photographerId,
        deviceTs: body.deviceTs ? new Date(body.deviceTs) : null,
        occurredAt: time.at,
      });
      await this.bookings.transition(tx, {
        bookingId: ctx.booking.bookingId,
        to: 'IN_PROGRESS',
        actor: SYSTEM_ACTOR,
        occurredAt: time.at,
        reason: 'Client did not attend (T&C §3.8): treated as completed',
        payload: { assignment_id: a.id, client_absent: true },
      });
      const view = await this.finish(tx, ctx, {
        fix: body,
        at: time.at,
        usedDeviceTime: time.usedDeviceTime,
        fence,
        frames: 0,
        clientAbsent: true,
      });
      const details = {
        assignment_id: a.id,
        event_id: reported.id,
        booking_total_paise: fromPaiseBigint(ctx.booking.totalPaise),
        balance_paise: fromPaiseBigint(ctx.booking.balancePaise),
      };
      await emit(tx, 'assignment.client_absent_reported', ctx.booking.bookingId, time.at, details);
      await needsReview(tx, ctx.booking.bookingId, 'CLIENT_NON_ATTENDANCE', time.at, details);
      return ClientAbsentResponseSchema.parse({ ...checkOutJson(view), eventId: reported.id });
    });
  }

  private timeOf(ctx: OnsiteContext, fix: GeoFix, now: Date) {
    return authoritativeTime({
      serverNow: now,
      deviceTs: fix.deviceTs ? new Date(fix.deviceTs) : undefined,
      offline: fix.offline,
      windowStart: ctx.assignment.blockedFrom,
      after: ctx.assignment.checkInAt ?? undefined,
    });
  }

  /** D4: the same event replayed → the recorded check-out (distance re-measured from the same fix). */
  private async replay(tx: Tx, ctx: OnsiteContext, fix: GeoFix): Promise<CheckOutView | null> {
    const a = ctx.assignment;
    if (!a.checkOutAt) return null;
    if (!sameInstant(a.checkOutDeviceTs, fix.deviceTs)) {
      throw conflict('CHECK_OUT_ALREADY_RECORDED', 'You have already checked out of this shoot');
    }
    const { slaT0, deliveryDueAt: due } = ctx.booking;
    if (!slaT0 || !due) throw new Error(`Booking ${ctx.booking.bookingId} lost its SLA anchors`);
    const measured = await this.assignments.measure(tx, ctx.booking, fix.lat, fix.lng);
    return {
      assignmentId: a.id,
      bookingId: ctx.booking.bookingId,
      checkedOutAt: a.checkOutAt,
      slaT0,
      deliveryDueAt: due,
      distanceM: measured.distanceM,
      basis: measured.basis,
      verified: measured.distanceM <= ONSITE_CONFIG.geofence.radiusM,
      declaredFrameCount: a.declaredFrameCount ?? 0,
      replayed: true,
    };
  }

  private async finish(tx: Tx, ctx: OnsiteContext, f: Finish): Promise<CheckOutView> {
    const a = ctx.assignment;
    const recorded = recordedFix(f.fix, f.at);
    if (!(await this.assignments.recordCheckOut(tx, a.id, recorded, f.frames))) {
      throw conflict('CHECK_OUT_ALREADY_RECORDED', 'You have already checked out of this shoot');
    }
    const due = deliveryDueAt(f.at, ctx.booking.hasRushDelivery);
    await this.bookings.recordCheckOut(tx, ctx.booking.bookingId, f.at, due);
    await this.bookings.transition(tx, {
      bookingId: ctx.booking.bookingId,
      to: 'CHECKED_OUT',
      actor: { kind: 'PHOTOGRAPHER', id: a.photographerId },
      occurredAt: f.at,
      reason: f.clientAbsent ? 'Client did not attend: checked out' : 'Geofenced check-out',
      metadata: {
        ...fenceMetadata(a.id, f.fence, f.fix, f.usedDeviceTime),
        client_absent: f.clientAbsent,
      },
      payload: {
        assignment_id: a.id,
        check_out_location: { lat: f.fix.lat, lng: f.fix.lng },
        sla_t0: f.at.toISOString(),
        declared_frame_count: f.frames,
        delivery_due_at: due.toISOString(),
        geofence_basis: f.fence.basis,
        geofence_verified: f.fence.verified,
        client_absent: f.clientAbsent,
      },
    });
    await this.geofence.flagUnverified(tx, ctx, 'CHECK_OUT', f.fence, recorded);
    return {
      assignmentId: a.id,
      bookingId: ctx.booking.bookingId,
      checkedOutAt: f.at,
      slaT0: f.at,
      deliveryDueAt: due,
      distanceM: f.fence.distanceM,
      basis: f.fence.basis,
      verified: f.fence.verified,
      declaredFrameCount: f.frames,
      replayed: false,
    };
  }
}
