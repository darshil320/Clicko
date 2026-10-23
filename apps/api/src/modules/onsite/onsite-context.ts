import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../bookings/bookings.service';
import type { OnsiteBookingFacts } from '../bookings/bookings.types';
import { AssignmentsService } from '../dispatch/assignments.service';
import type { OnsiteAssignment } from '../dispatch/dispatch.types';
import { assignmentNotFound } from './http-errors';
import type { Tx } from './onsite.types';

export interface OnsiteContext {
  readonly booking: OnsiteBookingFacts;
  readonly assignment: OnsiteAssignment;
}

/**
 * Loads an on-site context under row locks in the order every path uses: booking → assignment
 * (the same as dispatch). Someone else's assignment is 404, like a missing one.
 */
@Injectable()
export class OnsiteContextLoader {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
  ) {}

  async forPhotographer(
    tx: Tx,
    photographerId: string,
    assignmentId: string,
  ): Promise<OnsiteContext> {
    const ref = await this.assignments.findForPhotographer(tx, assignmentId, photographerId);
    if (!ref) throw assignmentNotFound();
    const ctx = await this.forAssignment(tx, assignmentId, ref.bookingId);
    if (!ctx) throw assignmentNotFound();
    return ctx;
  }

  /** System paths (jobs, dev console). null when the assignment does not exist. */
  async forAssignment(
    tx: Tx,
    assignmentId: string,
    knownBookingId?: string,
  ): Promise<OnsiteContext | null> {
    const bookingId =
      knownBookingId ?? (await this.assignments.find(tx, assignmentId))?.bookingId ?? null;
    if (!bookingId) return null;
    await this.bookings.lock(tx, bookingId);
    const assignment = await this.assignments.lock(tx, assignmentId);
    if (!assignment || assignment.bookingId !== bookingId) return null;
    return { booking: await this.bookings.onsiteFacts(tx, bookingId), assignment };
  }
}
