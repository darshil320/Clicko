import { Uuid } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { SlaDeskService } from '../../sla/sla-desk.service';
import type { CityResolverPort, ScopedEntity } from './staff-context';

/**
 * The booking city behind a scoped route's entity, asked of the module that owns each table.
 * Runs before the route's pipes, so a malformed id is simply "not found".
 */
@Injectable()
export class CityResolver implements CityResolverPort {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
  ) {}

  async cityOf(entity: ScopedEntity, id: string): Promise<string | null> {
    if (!Uuid.safeParse(id).success) return null;
    const bookingId =
      entity === 'booking'
        ? id
        : entity === 'assignment'
          ? await this.assignments.bookingIdOf(id)
          : await this.sla.breachBookingId(id);
    return bookingId ? this.bookings.cityOf(bookingId) : null;
  }
}
