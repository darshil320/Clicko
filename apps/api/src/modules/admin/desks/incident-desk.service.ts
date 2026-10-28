import type {
  AdminConfirmIncidentBody,
  AdminIncidentItem,
  AdminIncidentKind,
  AdminIncidentPage,
  ConfirmIncidentResponse,
} from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { IncidentsService } from '../../onsite/incidents.service';
import type { IncidentReportKind } from '../../onsite/repositories/assignment-events.repository';
import { PhotographersService } from '../../photographers/photographers.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import type { AuditContext, StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { decodeCursor, encodeCursor, type ListQuery, TimeSeqCursor } from './paging';

const KIND: Readonly<Record<IncidentReportKind, AdminIncidentKind>> = {
  ACCESS_DENIED_REPORTED: 'ACCESS_DENIED',
  UNSAFE_REPORTED: 'UNSAFE_SITE',
  CLIENT_ABSENT_REPORTED: 'CLIENT_ABSENT',
};

/**
 * The incident desk (ADR-0025 D5): reports not yet decided, oldest first, in the caller's cities.
 * ACCESS_DENIED and UNSAFE_SITE are confirmed here; CLIENT_ABSENT is listed for visibility (its
 * outcome is a money decision, S10).
 */
@Injectable()
export class IncidentDeskService {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(caller: StaffCaller, q: ListQuery): Promise<AdminIncidentPage> {
    const cursor = decodeCursor(TimeSeqCursor, q.cursor);
    const reports = await this.incidents.openReports(
      this.bookings.idsInScope(caller.scope, ['CHECKED_IN', 'IN_PROGRESS']),
      this.bookings.idsInScope(caller.scope, ['CHECKED_OUT']),
    );
    const key = (t: string, id: string) => `${t}|${id.padStart(20, '0')}`;
    const after = cursor ? key(cursor.t, cursor.i) : null;
    const rest = reports.filter(
      (r) => !after || key(r.reportedAt.toISOString(), r.eventId) > after,
    );
    const page = rest.slice(0, q.limit);
    const bookingIds = page.map((r) => r.bookingId);
    const [facts, assignments] = await Promise.all([
      this.bookings.adminFacts(bookingIds),
      this.assignments.latestForBookings(bookingIds),
    ]);
    const byId = new Map(facts.map((b) => [b.id, b]));
    const [cities, names] = await Promise.all([
      this.serviceability.cityNames(facts.map((b) => b.cityId)),
      this.photographers.displayNames([...assignments.values()].map((a) => a.photographerId)),
    ]);
    const items = page.flatMap((r): AdminIncidentItem[] => {
      const b = byId.get(r.bookingId);
      if (!b) return [];
      const a = assignments.get(r.bookingId);
      return [
        {
          eventId: r.eventId,
          kind: KIND[r.kind],
          assignmentId: r.assignmentId,
          bookingId: r.bookingId,
          reference: b.reference,
          bookingStatus: b.status,
          cityName: cities.get(b.cityId) ?? '',
          photographerName: a ? (names.get(a.photographerId) ?? '') : '',
          note: r.note,
          reportedAt: r.reportedAt.toISOString(),
        },
      ];
    });
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rest.length > q.limit && last
          ? encodeCursor({ t: last.reportedAt.toISOString(), i: last.eventId })
          : null,
    };
  }

  /** As this staff member; the audit row commits with the confirmation. */
  confirm(
    caller: StaffCaller,
    ctx: AuditContext,
    assignmentId: string,
    body: AdminConfirmIncidentBody,
  ): Promise<ConfirmIncidentResponse> {
    return this.incidents.confirm(
      assignmentId,
      body.kind,
      { kind: 'STAFF', id: caller.id },
      { note: body.note, audit: this.audit.hook(ctx, 'assignment', assignmentId) },
    );
  }
}
