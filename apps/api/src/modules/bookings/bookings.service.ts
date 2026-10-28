import type { BookingStatus } from '@clickco/contracts';
import { fromPaiseBigint } from '@clickco/utils';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import type { IdSubquery } from '../../infra/db/id-subquery';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import type { OnsiteCharge } from '../pricing/engine';
import {
  type AdminBookingFacts,
  type AdminBookingFilter,
  type AssignmentBookingDetail,
  type BookingChargeRecord,
  type BookingRow,
  type BookingView,
  type ChargeBasis,
  type CitySet,
  type CreateQuotedInput,
  type Db,
  type DeliveryBookingFacts,
  type DispatchFacts,
  type OfferBookingSummary,
  type OnsiteBookingFacts,
  type PromoUsage,
  type SnapshotTotals,
  SYSTEM_ACTOR,
  type TimelineEntry,
  type TransitionInput,
  type Tx,
} from './bookings.types';
import { BookingAdminRepository } from './repositories/booking-admin.repository';
import { BookingDeliveryRepository } from './repositories/booking-delivery.repository';
import { BookingDispatchRepository } from './repositories/booking-dispatch.repository';
import { BookingOnsiteRepository } from './repositories/booking-onsite.repository';
import { BookingReadsRepository } from './repositories/booking-reads.repository';
import { BookingsRepository, type NewBooking } from './repositories/bookings.repository';
import { toAddonRows, toChargeSnapshotRow, toSnapshotRow } from './snapshot-row';
import { assertTransition, eventTypeFor, IllegalTransitionError } from './state-machine';

const NOT_FOUND = { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' };

function toNewBooking(input: CreateQuotedInput, categoryId: string): NewBooking {
  const { request: r, quote: q, now } = input;
  return {
    userId: input.userId,
    cityId: input.cityId,
    categoryId,
    tier: q.tier,
    scheduledStart: new Date(r.scheduledStart),
    scheduledHours: q.hours,
    emergencyBand: q.emergencyBand,
    venuePincode: r.pincode,
    venueAddress: r.venueAddress,
    venueLandmark: r.venueLandmark ?? null,
    travelZone: q.travelZone,
    travelDistanceKm: r.travelDistanceKm ?? null,
    bookerName: r.booker.name,
    bookerPhone: r.booker.phone,
    subjectName: r.subject?.name ?? null,
    subjectPhone: r.subject?.phone ?? null,
    galleryRecipient: r.galleryRecipient,
    specialRequirements: r.specialRequirements ?? null,
    rulesetId: q.rulesetId,
    totalPaise: q.totalPaise,
    advancePaise: q.advancePaise,
    balancePaise: q.balancePaise,
    quoteExpiresAt: q.quoteExpiresAt,
    // Invariant 22: opt-in only, recorded with its timestamp.
    modelReleaseConsent: r.modelReleaseConsent,
    modelReleaseConsentAt: r.modelReleaseConsent ? now : null,
    createdAt: now,
  };
}

/**
 * Owns bookings, booking_price_snapshots, booking_addons and booking_status_events. Every status
 * change goes through transition(): row lock → state-machine check → UPDATE → status event →
 * outbox event, all in the caller's transaction (ADR-0009).
 */
@Injectable()
export class BookingsService {
  constructor(
    @Inject(BookingsRepository) private readonly writes: BookingsRepository,
    @Inject(BookingReadsRepository) private readonly reads: BookingReadsRepository,
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(BookingDispatchRepository) private readonly dispatchReads: BookingDispatchRepository,
    @Inject(BookingOnsiteRepository) private readonly onsite: BookingOnsiteRepository,
    @Inject(BookingDeliveryRepository) private readonly delivery: BookingDeliveryRepository,
    @Inject(BookingAdminRepository) private readonly admin: BookingAdminRepository,
  ) {}

  /** — → DRAFT → QUOTED with snapshot sequence 1 and its add-ons, in the caller's transaction. */
  async createQuoted(tx: Tx, input: CreateQuotedInput): Promise<BookingView> {
    const { quote, request, now } = input;
    const categoryId = await this.reads.activeCategoryId(tx, quote.categoryCode);
    if (!categoryId) {
      throw new UnprocessableEntityException({
        code: 'UNKNOWN_CATEGORY',
        message: `Category ${quote.categoryCode} is not offered`,
      });
    }
    const addonIds = await this.reads.addonIds(
      tx,
      request.addons.map((a) => a.code),
    );
    const bookingId = await this.writes.insertBooking(tx, toNewBooking(input, categoryId));
    await this.recordCreation(tx, bookingId, input);
    const snapshotId = await this.writes.insertSnapshot(tx, bookingId, toSnapshotRow(quote));
    await this.writes.insertAddons(tx, bookingId, toAddonRows(quote, request.addons, addonIds));
    await this.transition(tx, {
      bookingId,
      to: 'QUOTED',
      actor: SYSTEM_ACTOR,
      occurredAt: now,
      reason: 'Pricing engine resolved a quote',
      payload: {
        snapshot_id: snapshotId,
        total_paise: fromPaiseBigint(quote.totalPaise),
        advance_paise: fromPaiseBigint(quote.advancePaise),
        ruleset_version: quote.rulesetVersion,
        quote_expires_at: quote.quoteExpiresAt.toISOString(),
      },
    });
    return this.view(tx, bookingId);
  }

  async transition(tx: Tx, t: TransitionInput): Promise<void> {
    const booking = await this.lock(tx, t.bookingId);
    this.assertLegal(booking.status, t.to);
    const cancellation =
      t.cancellationReason === undefined
        ? null
        : { at: t.occurredAt, reason: t.cancellationReason };
    await this.writes.updateStatus(tx, t.bookingId, t.to, cancellation);
    await this.log(tx, booking.status, t);
  }

  /** SELECT … FOR UPDATE: holds the booking for the rest of the caller's transaction. */
  async lock(tx: Tx, bookingId: string): Promise<BookingRow> {
    const booking = await this.writes.lock(tx, bookingId);
    if (!booking) throw new NotFoundException(NOT_FOUND);
    return booking;
  }

  async addAmountPaid(tx: Tx, bookingId: string, amountPaise: bigint): Promise<void> {
    if (amountPaise <= 0n) throw new RangeError('addAmountPaid: amount must be positive');
    await this.writes.addAmountPaid(tx, bookingId, amountPaise);
  }

  async quoteSnapshotTotals(tx: Tx, bookingId: string): Promise<SnapshotTotals> {
    const totals = await this.reads.quoteSnapshotTotals(tx, bookingId);
    if (!totals) throw new Error(`Booking ${bookingId} has no quote snapshot`);
    return totals;
  }

  /** Every snapshot added up: what the booking's invoices must sum to (ADR-0016 D3). */
  async allSnapshotTotals(tx: Tx, bookingId: string): Promise<SnapshotTotals> {
    const totals = await this.reads.allSnapshotTotals(tx, bookingId);
    if (!totals) throw new Error(`Booking ${bookingId} has no quote snapshot`);
    return totals;
  }

  /** null for a missing booking AND for someone else's: never leak that a booking exists. */
  findForUser(userId: string, bookingId: string): Promise<BookingView | null> {
    return this.reads.byIdForUser(this.sql, userId, bookingId);
  }

  listForUser(userId: string): Promise<BookingView[]> {
    return this.reads.forUser(this.sql, userId);
  }

  timeline(bookingId: string): Promise<TimelineEntry[]> {
    return this.reads.timeline(this.sql, bookingId);
  }

  // ── Staff panel reads (ADR-0025 D5) ────────────────────────────────────────

  /** The booking board: filters, city scope and keyset cursor, all in SQL. */
  adminPage(filter: AdminBookingFilter): Promise<AdminBookingFacts[]> {
    return this.admin.page(this.sql, filter);
  }

  adminFacts(bookingIds: readonly string[]): Promise<AdminBookingFacts[]> {
    return this.admin.byIds(this.sql, bookingIds);
  }

  /** null when the booking does not exist. A booking's city never changes. */
  cityOf(bookingId: string): Promise<string | null> {
    return this.admin.cityOf(this.sql, bookingId);
  }

  /** Booking ids in these cities (and statuses), for another module's SQL filter. */
  idsInScope(scope: CitySet, statuses?: readonly BookingStatus[]): IdSubquery {
    return this.admin.idsWhere(this.sql, scope, statuses);
  }

  promoUsage(userId: string, promoCode: string, now: Date): Promise<PromoUsage> {
    return this.reads.promoUsage(this.sql, userId, promoCode, now);
  }

  /**
   * The same counts, under a transaction-scoped lock on the code: concurrent bookings using one
   * code queue here, so the caps cannot be over-redeemed between the count and the insert.
   */
  async promoUsageLocked(
    tx: Tx,
    userId: string,
    promoCode: string,
    now: Date,
  ): Promise<PromoUsage> {
    await this.reads.lockPromoCode(tx, promoCode);
    return this.reads.promoUsage(tx, userId, promoCode, now);
  }

  /** Dispatch inputs for one booking, in the caller's transaction. Throws 404 when absent. */
  async dispatchFacts(db: Db, bookingId: string): Promise<DispatchFacts> {
    const facts = await this.dispatchReads.facts(db, bookingId);
    if (!facts) throw new NotFoundException(NOT_FOUND);
    return facts;
  }

  /** DISPATCHING bookings starting before `cutoff` (the dispatch deadline sweeper). */
  dispatchingStartingBefore(cutoff: Date, limit: number): Promise<string[]> {
    return this.dispatchReads.dispatchingStartingBefore(this.sql, cutoff, limit);
  }

  offerSummaries(bookingIds: readonly string[]): Promise<OfferBookingSummary[]> {
    return this.dispatchReads.offerSummaries(this.sql, bookingIds);
  }

  assignmentDetails(bookingIds: readonly string[]): Promise<AssignmentBookingDetail[]> {
    return this.dispatchReads.assignmentDetails(this.sql, bookingIds);
  }

  // ── On-site operations (ADR-0013) ──────────────────────────────────────────

  /** Schedule, SLA anchors, totals and the snapshot-1 charge basis. Throws 404 when absent. */
  async onsiteFacts(db: Db, bookingId: string): Promise<OnsiteBookingFacts> {
    const facts = await this.onsite.facts(db, bookingId);
    if (!facts) throw new NotFoundException(NOT_FOUND);
    return facts;
  }

  /** bookings.actual_check_in, once (G-15: immutable once written). */
  async recordCheckIn(tx: Tx, bookingId: string, at: Date): Promise<void> {
    if (!(await this.onsite.setActualCheckIn(tx, bookingId, at))) {
      throw new ConflictException({
        code: 'CHECK_IN_ALREADY_RECORDED',
        message: 'Already checked in',
      });
    }
  }

  /**
   * actual_check_out and, from the same value, sla_t0 (Invariant 2), plus delivery_due_at. Once.
   * The caller then transitions IN_PROGRESS → CHECKED_OUT in the same transaction.
   */
  async recordCheckOut(tx: Tx, bookingId: string, at: Date, deliveryDueAt: Date): Promise<void> {
    if (!(await this.onsite.setCheckOut(tx, bookingId, at, deliveryDueAt))) {
      throw new ConflictException({
        code: 'CHECK_OUT_ALREADY_RECORDED',
        message: 'Already checked out',
      });
    }
  }

  /** Balance, paid amount, SLA anchors and delivery state (ADR-0016). Throws 404 when absent. */
  async deliveryFacts(db: Db, bookingId: string): Promise<DeliveryBookingFacts> {
    const facts = await this.delivery.facts(db, bookingId);
    if (!facts) throw new NotFoundException(NOT_FOUND);
    return facts;
  }

  /** sla_t0 + delivery_due_at for a T0 that is not a check-out (unsafe site). Once. */
  async recordSlaAnchor(
    tx: Tx,
    bookingId: string,
    t0: Date,
    deliveryDueAt: Date,
  ): Promise<boolean> {
    return this.delivery.setSlaAnchor(tx, bookingId, t0, deliveryDueAt);
  }

  /** delivered_at, once; the caller transitions BALANCE_PENDING → DELIVERED in the same tx. */
  async recordDelivered(tx: Tx, bookingId: string, at: Date): Promise<void> {
    await this.delivery.setDelivered(tx, bookingId, at);
  }

  async recordClosed(tx: Tx, bookingId: string, at: Date): Promise<void> {
    await this.delivery.setClosed(tx, bookingId, at);
  }

  /**
   * A new snapshot sequence holding only this charge, and total/balance up by its total (the
   * advance never moves, so advance + balance = total still holds). Caller holds the booking lock.
   */
  async addCharge(
    tx: Tx,
    bookingId: string,
    c: {
      readonly charge: OnsiteCharge;
      readonly basis: ChargeBasis;
      readonly breakdown: Record<string, unknown>;
      readonly computedAt: Date;
    },
  ): Promise<number> {
    const sequence = await this.onsite.nextSequence(tx, bookingId);
    const row = toChargeSnapshotRow(c.charge, c.basis, c.breakdown, sequence, c.computedAt);
    await this.onsite.insertSnapshot(tx, bookingId, row);
    await this.onsite.addToTotals(tx, bookingId, c.charge.totalPaise);
    return sequence;
  }

  /** Sequence 2+ snapshots (extensions, waiting) for one booking, in order. */
  async charges(db: Db, bookingId: string): Promise<BookingChargeRecord[]> {
    return this.onsite.charges(db, [bookingId]);
  }

  /** Sum of the extension/waiting payout shares per booking (Pro earnings). */
  async extraPayouts(bookingIds: readonly string[]): Promise<Map<string, bigint>> {
    const rows = await this.onsite.charges(this.sql, bookingIds);
    return rows.reduce(
      (m, r) => new Map(m).set(r.bookingId, (m.get(r.bookingId) ?? 0n) + r.expectedPayoutPaise),
      new Map<string, bigint>(),
    );
  }

  /** ASSIGNED / EN_ROUTE bookings that started in [startedAfter, startedBefore] (no-show sweep). */
  awaitingCheckIn(startedAfter: Date, startedBefore: Date, limit: number): Promise<string[]> {
    return this.onsite.awaitingCheckIn(this.sql, startedAfter, startedBefore, limit);
  }

  /** A booking as seen inside the caller's transaction (sees its own uncommitted changes). */
  async view(tx: Tx, bookingId: string): Promise<BookingView> {
    const view = await this.reads.byId(tx, bookingId);
    if (!view) throw new NotFoundException(NOT_FOUND);
    return view;
  }

  private assertLegal(from: BookingStatus | null, to: BookingStatus): void {
    try {
      assertTransition(from, to);
    } catch (error) {
      if (!(error instanceof IllegalTransitionError)) throw error;
      throw new ConflictException({
        code: 'ILLEGAL_TRANSITION',
        message: `A ${from ?? 'new'} booking cannot become ${to}`,
      });
    }
  }

  private async recordCreation(tx: Tx, bookingId: string, input: CreateQuotedInput): Promise<void> {
    this.assertLegal(null, 'DRAFT');
    await this.log(tx, null, {
      bookingId,
      to: 'DRAFT',
      actor: { kind: 'USER', id: input.userId },
      occurredAt: input.now,
      reason: 'Client started a booking',
      metadata: { accepted_terms_version: input.request.acceptedTermsVersion },
      payload: { user_id: input.userId },
    });
  }

  private async log(tx: Tx, from: BookingStatus | null, t: TransitionInput): Promise<void> {
    await this.writes.insertStatusEvent(tx, {
      bookingId: t.bookingId,
      from,
      to: t.to,
      actorKind: t.actor.kind,
      actorId: t.actor.id,
      reason: t.reason ?? null,
      metadata: t.metadata ?? null,
      occurredAt: t.occurredAt,
    });
    await appendDomainEvent(tx, {
      eventType: eventTypeFor(t.to, from),
      aggregateKind: 'booking',
      aggregateId: t.bookingId,
      occurredAt: t.occurredAt,
      payload: {
        booking_id: t.bookingId,
        from_status: from,
        to_status: t.to,
        actor_kind: t.actor.kind,
        ...(t.payload ?? {}),
      },
    });
  }
}
