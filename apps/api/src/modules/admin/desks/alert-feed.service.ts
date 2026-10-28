import type { AdminAlertPage } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { OpsAlertsReader } from '../../ops/ops-alerts.reader';
import type { StaffCaller } from '../access/staff-context';
import { decodeCursor, type ListQuery, pageOf, TimeSeqCursor } from './paging';
import { toAlert } from './views';

/**
 * The alert feed (ADR-0025 D5): `ops.alert` and `*.needs_review`, newest first. City-scoped
 * callers see alerts on their cities' bookings only; system-wide alerts (storage, dead letters)
 * need an every-city grant. Settling alerts is S10.
 */
@Injectable()
export class AlertFeedService {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(OpsAlertsReader) private readonly alerts: OpsAlertsReader,
  ) {}

  async list(caller: StaffCaller, q: ListQuery): Promise<AdminAlertPage> {
    const cursor = decodeCursor(TimeSeqCursor, q.cursor);
    const rows = await this.alerts.page({
      bookings: caller.scope === 'ALL' ? null : this.bookings.idsInScope(caller.scope),
      ...(cursor ? { after: { occurredAt: new Date(cursor.t), seq: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (a) => ({ t: a.occurredAt.toISOString(), i: a.seq }));
    const facts = await this.bookings.adminFacts(
      page.items.flatMap((a) => (a.bookingId ? [a.bookingId] : [])),
    );
    const refs = new Map(facts.map((b) => [b.id, b.reference]));
    return {
      items: page.items.map((a) =>
        toAlert(a, a.bookingId ? (refs.get(a.bookingId) ?? null) : null),
      ),
      nextCursor: page.nextCursor,
    };
  }
}
