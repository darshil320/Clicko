import type {
  AdminQaDecisionBody,
  AdminQaItem,
  AdminQaPage,
  DeliveryView,
} from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { QaService } from '../../delivery/qa.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { MediaRetentionService } from '../../media/media-retention.service';
import { PhotographersService } from '../../photographers/photographers.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import { SlaDeskService } from '../../sla/sla-desk.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor, type ListQuery, TimeCursor } from './paging';

/** QA is a short stage: the whole queue of the caller's cities is read, then sorted by due time. */
export const QA_QUEUE_CAP = 500;
/** Sorts last: a booking with no delivery clock (none should reach QA without one). */
const NO_DUE = '9999-12-31T23:59:59.999Z';

/** The QA desk (ADR-0025 D5): the queue, oldest due first, and the staff decision. */
@Injectable()
export class QaDeskService {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(MediaRetentionService) private readonly media: MediaRetentionService,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
    @Inject(QaService) private readonly qa: QaService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async queue(caller: StaffCaller, q: ListQuery): Promise<AdminQaPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const facts = await this.bookings.adminPage({
      scope: caller.scope,
      statuses: ['QA'],
      // Oldest first, so a queue over the cap drops the newest, never the most overdue.
      order: 'ASC',
      limit: QA_QUEUE_CAP,
    });
    const ids = facts.map((b) => b.id);
    const [cities, assignments, sla, inventories] = await Promise.all([
      this.serviceability.cityNames(facts.map((b) => b.cityId)),
      this.assignments.latestForBookings(ids),
      this.sla.boardFacts(ids),
      Promise.all(ids.map((id) => this.media.inventory(id))),
    ]);
    const names = await this.photographers.displayNames(
      [...assignments.values()].map((a) => a.photographerId),
    );
    const items: AdminQaItem[] = facts.map((b, i) => {
      const a = assignments.get(b.id);
      const inventory = inventories[i];
      return {
        bookingId: b.id,
        reference: b.reference,
        cityName: cities.get(b.cityId) ?? '',
        categoryCode: b.categoryCode,
        tier: b.tier,
        photographerName: a ? (names.get(a.photographerId) ?? '') : '',
        checkedOutAt: a?.checkOutAt?.toISOString() ?? null,
        declaredFrameCount: a?.declaredFrameCount ?? null,
        counts: {
          raw: inventory?.raw.files ?? 0,
          jpeg: inventory?.jpeg.files ?? 0,
          video: inventory?.video.files ?? 0,
        },
        dueAt: sla.get(b.id)?.deliveryDueAt?.toISOString() ?? null,
      };
    });
    const key = (item: AdminQaItem) => `${item.dueAt ?? NO_DUE}|${item.bookingId}`;
    const sorted = [...items].sort((a, b) => key(a).localeCompare(key(b)));
    const after = cursor ? `${cursor.t}|${cursor.i}` : null;
    const rest = after ? sorted.filter((item) => key(item) > after) : sorted;
    const page = rest.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page,
      nextCursor:
        rest.length > q.limit && last
          ? encodeCursor({ t: last.dueAt ?? NO_DUE, i: last.bookingId })
          : null,
    };
  }

  /** PASS or FAIL as this staff member; the audit row commits with the decision. */
  decide(
    caller: StaffCaller,
    ctx: AuditContext,
    bookingId: string,
    body: AdminQaDecisionBody,
  ): Promise<DeliveryView> {
    return this.qa.decide(
      bookingId,
      body.result,
      body.note ?? null,
      { kind: 'STAFF', id: caller.id },
      this.audit.hook(ctx, 'booking', bookingId),
    );
  }
}
