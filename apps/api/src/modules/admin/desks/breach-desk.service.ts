import type {
  AdminAttributeBreachBody,
  AdminBreachItem,
  AdminBreachPage,
  AdminWaiveBreachBody,
} from '@clickco/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CLOCK, type Clock } from '../../../common/clock';
import { BookingsService } from '../../bookings/bookings.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { PhotographersService } from '../../photographers/photographers.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { BreachRecord } from '../../sla/repositories/sla-breaches.repository';
import { SlaDeskService } from '../../sla/sla-desk.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { type BreachQuery, decodeCursor, pageOf, TimeCursor } from './paging';
import { toBreachItem } from './views';

/**
 * The SLA breach board (ADR-0025 D5): newest first, open / waived / all, in the caller's cities.
 * Attribute and waive record a decision; no remedy is ever applied here (S10).
 */
@Injectable()
export class BreachDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(caller: StaffCaller, q: BreachQuery): Promise<AdminBreachPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.sla.breachPage({
      status: q.status,
      bookings: caller.scope === 'ALL' ? null : this.bookings.idsInScope(caller.scope),
      ...(cursor ? { after: { createdAt: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (b) => ({ t: b.createdAt.toISOString(), i: b.id }));
    return { items: await this.items(page.items), nextCursor: page.nextCursor };
  }

  async attribute(
    caller: StaffCaller,
    ctx: AuditContext,
    breachId: string,
    body: AdminAttributeBreachBody,
  ): Promise<AdminBreachItem> {
    const breach = await this.sla.attribute(
      breachId,
      body.attributedTo,
      caller.id,
      body.note,
      this.clock(),
      this.audit.hook(ctx, 'sla_breach', breachId),
    );
    return this.item(breach);
  }

  async waive(
    caller: StaffCaller,
    ctx: AuditContext,
    breachId: string,
    body: AdminWaiveBreachBody,
  ): Promise<AdminBreachItem> {
    const breach = await this.sla.waive(
      breachId,
      caller.id,
      body.reason,
      this.clock(),
      this.audit.hook(ctx, 'sla_breach', breachId),
    );
    return this.item(breach);
  }

  private async item(breach: BreachRecord): Promise<AdminBreachItem> {
    const [item] = await this.items([breach]);
    if (!item)
      throw new NotFoundException({ code: 'BREACH_NOT_FOUND', message: 'Breach not found' });
    return item;
  }

  private async items(rows: readonly BreachRecord[]): Promise<AdminBreachItem[]> {
    const bookingIds = rows.map((b) => b.bookingId);
    const [facts, assignments] = await Promise.all([
      this.bookings.adminFacts(bookingIds),
      this.assignments.latestForBookings(bookingIds),
    ]);
    const byId = new Map(facts.map((b) => [b.id, b]));
    const [cities, names] = await Promise.all([
      this.serviceability.cityNames(facts.map((b) => b.cityId)),
      this.photographers.displayNames([...assignments.values()].map((a) => a.photographerId)),
    ]);
    return rows.flatMap((breach) => {
      const booking = byId.get(breach.bookingId);
      if (!booking) return [];
      const a = assignments.get(breach.bookingId);
      return [
        toBreachItem(breach, {
          reference: booking.reference,
          cityName: cities.get(booking.cityId) ?? '',
          photographerName: a ? (names.get(a.photographerId) ?? null) : null,
        }),
      ];
    });
  }
}
