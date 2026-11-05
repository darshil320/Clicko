import { Inject, Injectable } from '@nestjs/common';
import type { Tx } from './dispatch.types';
import { AssignmentsRepository } from './repositories/assignments.repository';
import { AttemptsRepository } from './repositories/attempts.repository';
import { RoundsRepository } from './repositories/rounds.repository';

/** The photographer who held the booking when it was cancelled. */
export interface ReleasedAssignment {
  readonly assignmentId: string;
  readonly photographerId: string;
}

/**
 * A booking cancelled before the shoot (CANCELLED_CLIENT, DOMAIN §2) lets go of dispatch in the
 * caller's transaction, which already holds the booking lock (the accept path's lock order, so an
 * accept either commits first or finds the booking gone): the held assignment is RELEASED — its
 * calendar block no longer counts (Invariant 8) — open offers are CANCELLED and open rounds end.
 * `booking.cancelled_client` repeats the offer close idempotently (DispatchStartService); every
 * dispatch job re-reads state and does nothing for a cancelled booking.
 */
@Injectable()
export class DispatchReleaseService {
  constructor(
    @Inject(AssignmentsRepository) private readonly assignments: AssignmentsRepository,
    @Inject(AttemptsRepository) private readonly attempts: AttemptsRepository,
    @Inject(RoundsRepository) private readonly rounds: RoundsRepository,
  ) {}

  async releaseForCancellationIn(
    tx: Tx,
    bookingId: string,
    reason: string,
    at: Date,
  ): Promise<ReleasedAssignment | null> {
    const active = await this.assignments.activeForBooking(tx, bookingId);
    if (active) await this.assignments.end(tx, active.id, 'RELEASED', reason, at);
    await this.attempts.cancelPending(tx, bookingId);
    await this.rounds.endOpen(tx, bookingId, 'CANCELLED', at);
    return active ? { assignmentId: active.id, photographerId: active.photographerId } : null;
  }
}
