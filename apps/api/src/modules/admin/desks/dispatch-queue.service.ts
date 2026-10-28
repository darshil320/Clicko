import type { AdminDispatchItem, AdminDispatchPage, DispatchDeskView } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { DispatchDeskService } from '../../dispatch/dispatch-desk.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { StaffCaller } from '../access/staff-context';
import { decodeCursor, type ListQuery, pageOf, TimeCursor } from './paging';

/** The dispatch desk (ADR-0025 D5): DISPATCHING bookings, soonest start first. View only in S9. */
@Injectable()
export class DispatchQueueService {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(DispatchDeskService) private readonly desk: DispatchDeskService,
  ) {}

  async list(caller: StaffCaller, q: ListQuery): Promise<AdminDispatchPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const facts = await this.bookings.adminPage({
      scope: caller.scope,
      statuses: ['DISPATCHING'],
      order: 'ASC',
      ...(cursor ? { after: { scheduledStart: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(facts, q.limit, (b) => ({ t: b.scheduledStart.toISOString(), i: b.id }));
    const [cities, queue] = await Promise.all([
      this.serviceability.cityNames(page.items.map((b) => b.cityId)),
      this.desk.queue(page.items.map((b) => b.id)),
    ]);
    const items = page.items.flatMap((b): AdminDispatchItem[] => {
      const run = queue.get(b.id);
      if (!run) return [];
      return [
        {
          bookingId: b.id,
          reference: b.reference,
          cityName: cities.get(b.cityId) ?? '',
          categoryCode: b.categoryCode,
          tier: b.tier,
          emergencyBand: b.emergencyBand,
          scheduledStart: b.scheduledStart.toISOString(),
          wave: run.wave,
          exhausted: run.exhausted,
          pendingOffers: run.pendingOffers,
          deadlineAt: run.deadlineAt.toISOString(),
        },
      ];
    });
    return { items, nextCursor: page.nextCursor };
  }

  /** Rounds, offers and assignments (the dev desk's view). The guard checked the city. */
  detail(bookingId: string): Promise<DispatchDeskView> {
    return this.desk.view(bookingId);
  }
}
