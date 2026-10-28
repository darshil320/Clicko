import {
  type AssignmentEventView,
  type BookingCharge,
  type BookingPendingExtension,
  type DevAssignmentView,
  DevAssignmentView as DevAssignmentViewSchema,
  type ProAssignmentDetail,
  ProAssignmentDetail as ProAssignmentDetailSchema,
} from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { BookingsService } from '../bookings/bookings.service';
import type { OnsiteBookingFacts } from '../bookings/bookings.types';
import { AssignmentsService } from '../dispatch/assignments.service';
import type { OnsiteAssignment } from '../dispatch/dispatch.types';
import { maskOrNull, maskPhoneNumbers } from '../dispatch/masking';
import { clientDisplayName } from '../dispatch/views';
import { PricingService } from '../pricing/pricing.service';
import { ServiceabilityService } from '../serviceability/serviceability.service';
import { ExtensionRecords } from './extension-records';
import { assignmentNotFound } from './http-errors';
import { AssignmentEventsRepository } from './repositories/assignment-events.repository';
import { billingStartsAt, earliestCheckOutAt } from './rules/timing';
import {
  checkInView,
  checkOutView,
  toBookingCharge,
  toEventView,
  toExtensionView,
  toPendingExtension,
} from './views';

/** Assignment states a photographer may still open; the address shows only while active. */
const VISIBLE = ['ASSIGNED', 'EN_ROUTE', 'ACTIVE', 'COMPLETED'] as const;
const ADDRESS_VISIBLE = ['ASSIGNED', 'EN_ROUTE', 'ACTIVE'] as const;
const includes = (list: readonly string[], s: string) => list.includes(s);

/** Read models: the Pro assignment detail, the client's on-site extras, the dev console view. */
@Injectable()
export class OnsiteViewsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentsService) private readonly assignments: AssignmentsService,
    @Inject(PricingService) private readonly pricing: PricingService,
    @Inject(ServiceabilityService) private readonly serviceability: ServiceabilityService,
    @Inject(ExtensionRecords) private readonly records: ExtensionRecords,
    @Inject(AssignmentEventsRepository) private readonly events: AssignmentEventsRepository,
  ) {}

  /** Every on-site event of an assignment, oldest first (the staff booking page, ADR-0025). */
  async eventViews(assignmentId: string): Promise<AssignmentEventView[]> {
    return (await this.events.forAssignment(this.sql, assignmentId)).map(toEventView);
  }

  /** GET /pro/assignments/:id — own work only; RELEASED / ABANDONED look like someone else's. */
  async proDetail(photographerId: string, assignmentId: string): Promise<ProAssignmentDetail> {
    const now = this.clock();
    const a = await this.assignments.findForPhotographer(this.sql, assignmentId, photographerId);
    if (!a || !includes(VISIBLE, a.status)) throw assignmentNotFound();
    const [detail] = await this.bookings.assignmentDetails([a.bookingId]);
    if (!detail) throw assignmentNotFound();
    const facts = await this.bookings.onsiteFacts(this.sql, a.bookingId);
    const [labels, payouts, { ledger, events }] = await Promise.all([
      this.serviceability.areaLabels([detail.venuePincode]),
      this.assignments.acceptedPayouts(photographerId, [a.bookingId]),
      this.records.ledger(this.sql, a.id, now),
    ]);
    const label = labels.get(detail.venuePincode);
    const showAddress = includes(ADDRESS_VISIBLE, a.status);
    const billingStart = a.checkInAt ? billingStartsAt(a.checkInAt, facts.scheduledStart) : null;
    const pending = ledger.open
      ? toExtensionView(ledger.open, await this.extensionPrice(facts), {
          assignmentId: a.id,
          bookingId: a.bookingId,
        })
      : null;
    return ProAssignmentDetailSchema.parse({
      assignmentId: a.id,
      bookingId: a.bookingId,
      bookingReference: detail.reference,
      bookingStatus: facts.status,
      status: a.status,
      categoryCode: detail.categoryCode,
      tier: detail.tier,
      scheduledStart: detail.scheduledStart.toISOString(),
      scheduledHours: detail.scheduledHours,
      payoutPaise: fromPaiseBigint(payouts.get(a.bookingId) ?? detail.expectedPayoutPaise),
      venue: {
        address: showAddress ? maskPhoneNumbers(detail.venueAddress) : null,
        landmark: showAddress ? maskOrNull(detail.venueLandmark) : null,
        pincode: detail.venuePincode,
        areaName: label?.areaName ?? null,
        cityName: label?.cityName ?? '',
      },
      clientDisplayName: clientDisplayName(detail.bookerName),
      specialRequirements: showAddress ? maskOrNull(detail.specialRequirements) : null,
      acceptedAt: a.acceptedAt.toISOString(),
      checkIn: checkInView(a),
      checkOut: checkOutView(a),
      billingStartsAt: billingStart?.toISOString() ?? null,
      earliestCheckOutAt: billingStart
        ? earliestCheckOutAt(billingStart, facts.scheduledHours, ledger.approvedCount).toISOString()
        : null,
      approvedExtensionHours: ledger.approvedCount,
      pendingExtension: pending,
      events: events.map(toEventView),
    });
  }

  /** BookingDetail extras for the client (ADR-0013 D14). Photographer notes are never included. */
  async clientExtras(bookingId: string): Promise<{
    readonly pendingExtensions: BookingPendingExtension[];
    readonly charges: BookingCharge[];
  }> {
    const now = this.clock();
    const charges = (await this.bookings.charges(this.sql, bookingId)).map(toBookingCharge);
    const active = await this.assignments.activeForBooking(this.sql, bookingId);
    if (!active) return { pendingExtensions: [], charges };
    const { ledger } = await this.records.ledger(this.sql, active.id, now);
    if (!ledger.open) return { pendingExtensions: [], charges };
    const facts = await this.bookings.onsiteFacts(this.sql, bookingId);
    if (facts.status !== 'IN_PROGRESS') return { pendingExtensions: [], charges };
    return {
      pendingExtensions: [toPendingExtension(ledger.open, await this.extensionPrice(facts))],
      charges,
    };
  }

  /** GET /dev/assignments/:id (development only). */
  async devView(assignmentId: string): Promise<DevAssignmentView> {
    const a = await this.assignments.find(this.sql, assignmentId);
    if (!a) throw assignmentNotFound();
    const facts = await this.bookings.onsiteFacts(this.sql, a.bookingId);
    const { events } = await this.records.ledger(this.sql, a.id, this.clock());
    return DevAssignmentViewSchema.parse({
      ...devAssignmentFields(a),
      bookingStatus: facts.status,
      events: events.map(toEventView),
    });
  }

  private extensionPrice(facts: OnsiteBookingFacts) {
    return this.pricing.extensionCharge(facts.rulesetId, facts.chargeBasis, 1);
  }
}

function devAssignmentFields(a: OnsiteAssignment) {
  return {
    assignmentId: a.id,
    bookingId: a.bookingId,
    photographerId: a.photographerId,
    status: a.status,
    isReplacement: a.isReplacement,
    blockedFrom: a.blockedFrom.toISOString(),
    blockedUntil: a.blockedUntil.toISOString(),
    acceptedAt: a.acceptedAt.toISOString(),
    checkIn: checkInView(a),
    checkOut: checkOutView(a),
  };
}
