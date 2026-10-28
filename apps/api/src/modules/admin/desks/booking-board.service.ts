import type {
  AdminBookingDetailWithAudit,
  AdminBookingPage,
  AdminBookingRow,
  StaffRole,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BookingsService } from '../../bookings/bookings.service';
import type { AdminBookingFacts } from '../../bookings/bookings.types';
import { QaService } from '../../delivery/qa.service';
import { AssignmentReads } from '../../dispatch/assignment-reads.service';
import { IncidentsService } from '../../onsite/incidents.service';
import { OnsiteViewsService } from '../../onsite/onsite-views.service';
import { OpsAlertsReader } from '../../ops/ops-alerts.reader';
import { PaymentsService } from '../../payments/payments.service';
import { PhotographersService } from '../../photographers/photographers.service';
import { ServiceabilityService } from '../../serviceability/serviceability.service';
import { SlaDeskService } from '../../sla/sla-desk.service';
import { canSeeClientPhone, DESK_ROLES, maskPhone, scopeFor } from '../access/roles';
import type { StaffCaller } from '../access/staff-context';
import { AuditService } from '../audit/audit.service';
import { flagsFor } from './flags';
import { type BookingQuery, DAY_MS, decodeCursor, istDayStart, pageOf, TimeCursor } from './paging';
import { toAlert, toAuditEntry, toBookingRow, toBreachView } from './views';

const NOT_FOUND = { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };
/** Roles that see client phones (READ_ONLY sees them masked, ADR-0025 D3). */
const PHONE_ROLES: readonly StaffRole[] = DESK_ROLES.bookings.filter((r) => r !== 'READ_ONLY');

/**
 * The booking board and booking page (ADR-0025 D5). Bookings come from BookingsService with the
 * caller's city scope in SQL; every other fact is asked of the module that owns it.
 */
@Injectable()
export class BookingBoardService {
  constructor(
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(PhotographersService) private readonly photographers: PhotographersService,
    @Inject(SlaDeskService) private readonly sla: SlaDeskService,
    @Inject(OpsAlertsReader) private readonly alerts: OpsAlertsReader,
    @Inject(IncidentsService) private readonly incidents: IncidentsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(QaService) private readonly qa: QaService,
    @Inject(OnsiteViewsService) private readonly onsite: OnsiteViewsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async page(caller: StaffCaller, q: BookingQuery): Promise<AdminBookingPage> {
    const cursor = decodeCursor(TimeCursor, q.cursor);
    const facts = await this.bookings.adminPage({
      scope: caller.scope,
      ...(q.cityId ? { cityId: q.cityId } : {}),
      ...(q.status ? { statuses: q.status } : {}),
      ...(q.from ? { startsFrom: istDayStart(q.from) } : {}),
      ...(q.to ? { startsBefore: new Date(istDayStart(q.to).getTime() + DAY_MS) } : {}),
      ...(q.q ? { search: { text: q.q, phoneScope: scopeFor(caller.grants, PHONE_ROLES) } } : {}),
      ...(q.needsAttention ? { within: this.alerts.bookingsNeedingAttention() } : {}),
      ...(cursor ? { after: { scheduledStart: new Date(cursor.t), id: cursor.i } } : {}),
      limit: q.limit + 1,
    });
    const page = pageOf(facts, q.limit, (b) => ({ t: b.scheduledStart.toISOString(), i: b.id }));
    return { items: await this.rows(page.items), nextCursor: page.nextCursor };
  }

  /** Rows for bookings already filtered to the caller's cities. */
  async rows(facts: readonly AdminBookingFacts[]): Promise<AdminBookingRow[]> {
    const ids = facts.map((b) => b.id);
    const [cities, assignments, sla, alerts, reports] = await Promise.all([
      this.serviceability.cityNames(facts.map((b) => b.cityId)),
      this.assignments.latestForBookings(ids),
      this.sla.boardFacts(ids),
      this.alerts.forBookings(ids),
      this.incidents.reportKinds(ids),
    ]);
    const names = await this.photographers.displayNames(
      [...assignments.values()].map((a) => a.photographerId),
    );
    return facts.map((b) => {
      const assignment = assignments.get(b.id);
      return toBookingRow(b, {
        cityName: cities.get(b.cityId) ?? '',
        photographerName: assignment ? (names.get(assignment.photographerId) ?? null) : null,
        nextDueAt: sla.get(b.id)?.nextDueAt ?? null,
        flags: flagsFor({
          status: b.status,
          alertTypes: (alerts.get(b.id) ?? []).map((a) => a.type),
          slaBreached: sla.get(b.id)?.breached ?? false,
          reportKinds: reports.get(b.id) ?? new Set(),
        }),
      });
    });
  }

  /** The booking page. The guard has already checked the booking's city against the caller. */
  async detail(caller: StaffCaller, bookingId: string): Promise<AdminBookingDetailWithAudit> {
    const [facts] = await this.bookings.adminFacts([bookingId]);
    if (!facts) throw new NotFoundException(NOT_FOUND);
    const [[row], timeline, payments, assignments, delivery, clocks, breaches, alerts] =
      await Promise.all([
        this.rows([facts]),
        this.bookings.timeline(bookingId),
        this.payments.listForBooking(bookingId),
        this.assignments.latestForBookings([bookingId]),
        this.qa.view(bookingId),
        this.sla.clockViews(bookingId),
        this.sla.breachesForBooking(bookingId),
        this.alerts.forBookings([bookingId]),
      ]);
    if (!row) throw new NotFoundException(NOT_FOUND);
    const assignment = assignments.get(bookingId) ?? null;
    const [contacts, events, audit] = await Promise.all([
      this.photographers.contacts(assignment ? [assignment.photographerId] : []),
      assignment ? this.onsite.eventViews(assignment.assignmentId) : Promise.resolve([]),
      this.audit.forEntities([
        { kind: 'booking', ids: [bookingId] },
        { kind: 'assignment', ids: assignment ? [assignment.assignmentId] : [] },
        { kind: 'sla_breach', ids: breaches.map((b) => b.id) },
      ]),
    ]);
    const pro = assignment ? contacts.get(assignment.photographerId) : undefined;
    return {
      ...row,
      venue: {
        address: facts.venueAddress,
        landmark: facts.venueLandmark,
        pincode: facts.venuePincode,
      },
      client: {
        name: facts.clientName,
        phone: canSeeClientPhone(caller.grants, facts.cityId)
          ? facts.clientPhone
          : maskPhone(facts.clientPhone),
      },
      advancePaise: fromPaiseBigint(facts.advancePaise),
      balancePaise: fromPaiseBigint(facts.balancePaise),
      timeline: timeline.map((t) => ({
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        actorKind: t.actorKind,
        reason: t.reason,
        occurredAt: t.occurredAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        kind: p.purpose,
        status: p.status,
        amountPaise: fromPaiseBigint(p.amountPaise),
        createdAt: p.createdAt.toISOString(),
      })),
      assignment:
        assignment && pro
          ? {
              assignmentId: assignment.assignmentId,
              photographerId: assignment.photographerId,
              photographerName: pro.name,
              photographerPhone: pro.phone,
              status: assignment.status,
              acceptedAt: assignment.acceptedAt.toISOString(),
              checkedInAt: assignment.checkInAt?.toISOString() ?? null,
              checkedOutAt: assignment.checkOutAt?.toISOString() ?? null,
              events,
            }
          : null,
      qaStatus: delivery.qaStatus,
      slaClocks: clocks,
      breaches: breaches.map(toBreachView),
      alerts: (alerts.get(bookingId) ?? []).map((a) => toAlert(a, facts.reference)),
      audit: audit.map(toAuditEntry),
    };
  }
}
