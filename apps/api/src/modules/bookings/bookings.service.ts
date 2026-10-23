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
import { appendDomainEvent } from '../../infra/outbox/outbox';
import {
  type AssignmentBookingDetail,
  type BookingRow,
  type BookingView,
  type CreateQuotedInput,
  type Db,
  type DispatchFacts,
  type OfferBookingSummary,
  type PromoUsage,
  type SnapshotTotals,
  SYSTEM_ACTOR,
  type TimelineEntry,
  type TransitionInput,
  type Tx,
} from './bookings.types';
import { BookingDispatchRepository } from './repositories/booking-dispatch.repository';
import { BookingReadsRepository } from './repositories/booking-reads.repository';
import { BookingsRepository, type NewBooking } from './repositories/bookings.repository';
import { toAddonRows, toSnapshotRow } from './snapshot-row';
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
