import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';
import { readDomainEvent } from '../../../infra/outbox/outbox';
import type { PublishedEvent } from '../../../infra/outbox/outbox-subscribers';
import { BookingsService } from '../../bookings/bookings.service';
import type { BookingContactFacts } from '../../bookings/bookings.types';
import { CallsService } from '../../calls/calls.service';
import { ReleaseService } from '../../delivery/release.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { PhotographersService } from '../../photographers/photographers.service';
import { UsersService } from '../../users/users.service';
import type { Recipient } from '../notifications.types';
import type { EventContext } from './event-map';

/**
 * The pipeline's reads of other modules, each through the owning module's service (apps/api
 * CLAUDE.md: never another module's tables): bookings, users, photographers, dispatch
 * (assignments), delivery (link tokens) and calls (the virtual number).
 */
@Injectable()
export class NotificationReaders {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(ReleaseService) private readonly release: ReleaseService,
    @Inject(CallsService) private readonly calls: CallsService,
  ) {}

  /** A queued job carries the event id only; the event is read when the job runs. */
  event(eventId: string): Promise<PublishedEvent | null> {
    return readDomainEvent(this.sql, eventId);
  }

  context(now: Date): EventContext {
    return {
      now,
      virtualNumber: this.calls.virtualNumber,
      booking: (id) => this.bookings.contactFacts(id),
      photographerName: async (id) =>
        (await this.photographers.contacts([id])).get(id)?.name ?? null,
      currentAssignment: async (bookingId) => {
        const latest = (await this.assignments.latestForBookings([bookingId])).get(bookingId);
        return latest
          ? { assignmentId: latest.assignmentId, photographerId: latest.photographerId }
          : null;
      },
      deliveryLinkToken: (bookingId) => this.release.primaryLinkToken(bookingId),
      userPhone: async (userId) => (await this.users.findById(userId))?.phone ?? null,
    };
  }

  /** The recipient's phone (E.164), or null — read when the message goes, never stored. */
  async phoneOf(r: Recipient): Promise<string | null> {
    if (r.kind === 'USER') return (await this.users.findById(r.id))?.phone ?? null;
    if (r.kind === 'PHOTOGRAPHER') {
      return (await this.photographers.contacts([r.id])).get(r.id)?.phone ?? null;
    }
    const booking: BookingContactFacts | null = await this.bookings.contactFacts(r.id);
    return booking?.subjectPhone ?? null;
  }
}
