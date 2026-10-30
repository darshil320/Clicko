import type {
  AdminOpenQualityBody,
  AdminQualityItem,
  AdminQualityPage,
  AdminQualityQuery,
  AdminResolveQualityBody,
} from '@clickco/contracts';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../../common/clock';
import type { QualityRecord } from '../../care/care.types';
import { QualityService } from '../../care/quality.service';
import type { CityScope } from '../access/roles';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { CareContext } from './care-context';
import { toQualityItem } from './care-views';
import { decodeCursor, pageOf, TimeCursor } from './paging';

export type QualityQuery = z.output<typeof AdminQualityQuery>;

const NOT_FOUND = { code: 'QUALITY_ISSUE_NOT_FOUND', message: 'Quality issue not found' };

/** The Quality issues desk (ADR-0026 D6): the QM queue over quality_escalations. */
@Injectable()
export class QualityIssuesDeskService {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(QualityService) private readonly quality: QualityService,
    @Inject(CareContext) private readonly context: CareContext,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(caller: StaffCaller, q: QualityQuery): Promise<AdminQualityPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const rows = await this.quality.page({
      filter: q.status,
      bookings: this.context.bookingScope(caller.scope),
      ...(cursor ? { after: { at: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(rows, q.limit, (r) => ({
      t: (q.status === 'RESOLVED' && r.resolvedAt ? r.resolvedAt : r.createdAt).toISOString(),
      i: r.id,
    }));
    return { items: await this.items(page.items), nextCursor: page.nextCursor };
  }

  async open(
    caller: StaffCaller,
    ctx: AuditContext,
    body: AdminOpenQualityBody,
  ): Promise<AdminQualityItem> {
    const bookingId = await this.context.bookingIdFor(body.bookingReference, caller.scope);
    const issue = await this.quality.open({
      bookingId,
      complaint: body.complaint,
      staffId: caller.id,
      now: this.clock(),
      auditFor: (id) => this.audit.hook(ctx, 'quality_escalation', id),
    });
    return this.item(issue);
  }

  async take(caller: StaffCaller, ctx: AuditContext, id: string): Promise<AdminQualityItem> {
    const issue = await this.quality.take({
      id,
      staffId: caller.id,
      bookings: this.context.bookingScope(caller.scope),
      audit: this.audit.hook(ctx, 'quality_escalation', id),
    });
    return this.item(issue);
  }

  async resolve(
    caller: StaffCaller,
    ctx: AuditContext,
    id: string,
    body: AdminResolveQualityBody,
  ): Promise<AdminQualityItem> {
    const issue = await this.quality.resolve({
      id,
      outcome: body.outcome,
      amountPaise: body.amountPaise ?? 0,
      note: body.note,
      staffId: caller.id,
      bookings: this.context.bookingScope(caller.scope),
      now: this.clock(),
      audit: this.audit.hook(ctx, 'quality_escalation', id),
    });
    return this.item(issue);
  }

  /** Today: quality issues open or in review in `scope`. */
  overviewOpen(scope: CityScope): Promise<number> {
    return this.quality.countOpen(this.context.bookingScope(scope));
  }

  private async item(issue: QualityRecord): Promise<AdminQualityItem> {
    const [item] = await this.items([issue]);
    if (!item) throw new NotFoundException(NOT_FOUND);
    return item;
  }

  private async items(rows: readonly QualityRecord[]): Promise<AdminQualityItem[]> {
    const [ctx, staff] = await Promise.all([
      this.context.bookingsContext(rows.map((r) => r.bookingId)),
      this.context.staff.of(rows.flatMap((r) => [r.raisedById, r.assignedQmId])),
    ]);
    return rows.flatMap((r) => {
      const item = toQualityItem(r, ctx, staff);
      return item ? [item] : [];
    });
  }
}
