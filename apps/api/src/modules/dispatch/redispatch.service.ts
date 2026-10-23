import type { BookingStatus, CancelAssignmentResponse } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import { type Actor, SYSTEM_ACTOR } from '../bookings/bookings.types';
import { PhotographersService } from '../photographers/photographers.service';
import type { DispatchTimer, Tx } from './dispatch.types';
import { DispatchEngine } from './dispatch-engine.service';
import { assignmentNotFound, conflict } from './http-errors';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { DispatchTimerScheduler } from './timer-scheduler';

export type RedispatchKind = 'PRO_CANCELLED' | 'NO_SHOW';

/** The post-acceptance states that can go back to dispatch (ADR-0011). */
const REDISPATCHABLE: readonly BookingStatus[] = ['ASSIGNED', 'EN_ROUTE'];

/**
 * ADR-0011 re-dispatch: ASSIGNED / EN_ROUTE → DISPATCHING. The assignment is RELEASED (the
 * photographer cancelled) or ABANDONED (no-show), the penalty is recorded (ADR-0012 D7) and a
 * fresh run starts — a no-show always re-broadcasts at the incentive. The no-show detector itself
 * is Sprint 6.
 */
@Injectable()
export class RedispatchService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(DispatchEngine) private readonly engine: DispatchEngine,
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
    @Inject(DispatchTimerScheduler) private readonly timers: DispatchTimerScheduler,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
  ) {}

  /**
   * Releases the active assignment and starts a new search. `expectedAssignmentId` guards a
   * photographer's cancel against a booking that has since been re-assigned.
   */
  async redispatch(
    bookingId: string,
    reason: string,
    kind: RedispatchKind,
    actor: Actor = SYSTEM_ACTOR,
    expectedAssignmentId?: string,
  ): Promise<{ readonly assignmentId: string }> {
    const now = this.clock();
    const { assignmentId, timers } = await this.sql.begin((tx) =>
      this.redispatchInTx(tx, { bookingId, reason, kind, actor, expectedAssignmentId }, now),
    );
    await this.timers.scheduleOrLog(timers);
    return { assignmentId };
  }

  /** POST /pro/assignments/:id/cancel — only the assigned photographer, only before the shoot. */
  async cancelByPhotographer(
    photographerId: string,
    assignmentId: string,
    reason: string,
  ): Promise<CancelAssignmentResponse> {
    const assignment = await this.assignments.findForPhotographer(
      this.sql,
      assignmentId,
      photographerId,
    );
    if (!assignment) throw assignmentNotFound();
    await this.redispatch(
      assignment.bookingId,
      reason,
      'PRO_CANCELLED',
      { kind: 'PHOTOGRAPHER', id: photographerId },
      assignmentId,
    );
    return { assignmentId, status: 'RELEASED' };
  }

  private async redispatchInTx(
    tx: Tx,
    r: {
      readonly bookingId: string;
      readonly reason: string;
      readonly kind: RedispatchKind;
      readonly actor: Actor;
      readonly expectedAssignmentId: string | undefined;
    },
    now: Date,
  ): Promise<{ assignmentId: string; timers: DispatchTimer[] }> {
    const booking = await this.bookings.lock(tx, r.bookingId);
    if (!REDISPATCHABLE.includes(booking.status)) {
      throw conflict('NOT_REDISPATCHABLE', `A ${booking.status} booking cannot be re-dispatched`);
    }
    const active = await this.assignments.activeForBooking(tx, r.bookingId);
    if (!active || (r.expectedAssignmentId && active.id !== r.expectedAssignmentId)) {
      throw conflict('ASSIGNMENT_NOT_ACTIVE', 'This assignment is no longer active');
    }
    const status = r.kind === 'NO_SHOW' ? 'ABANDONED' : 'RELEASED';
    await this.assignments.end(tx, active.id, status, r.reason, now);
    await this.photographers.recordPenalty(tx, {
      photographerId: active.photographerId,
      bookingId: r.bookingId,
      kind: r.kind === 'NO_SHOW' ? 'NO_SHOW' : 'CONDUCT',
      note: r.kind === 'NO_SHOW' ? `no-show: ${r.reason}` : `late cancellation: ${r.reason}`,
      at: now,
    });
    await this.bookings.transition(tx, {
      bookingId: r.bookingId,
      to: 'DISPATCHING',
      actor: r.actor,
      occurredAt: now,
      reason: r.kind === 'NO_SHOW' ? 'Photographer no-show' : 'Photographer cancelled',
      metadata: { assignment_id: active.id, redispatch_kind: r.kind, note: r.reason },
      payload: {
        assignment_id: active.id,
        photographer_id: active.photographerId,
        redispatch_kind: r.kind,
      },
    });
    const facts = await this.bookings.dispatchFacts(tx, r.bookingId);
    return { assignmentId: active.id, timers: await this.engine.startRun(tx, facts, r.kind, now) };
  }
}
