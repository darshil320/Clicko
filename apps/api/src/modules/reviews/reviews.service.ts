import { canEditReview, type ReviewBody } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { ReportsReader } from '../safety/reports.reader';
import {
  bookingNotFound,
  editWindowClosed,
  notDeliveredYet,
  reviewHidden,
  reviewModerated,
  reviewNotFound,
  reviewUnderModeration,
} from './http-errors';
import { ReviewsRepository } from './repositories/reviews.repository';
import { cleanComment, isReviewable } from './review-rules';
import type { ReviewModeration, ReviewRecord, Tx } from './reviews.types';

type ReviewEvent = 'review.submitted' | 'review.edited' | 'review.hidden' | 'review.kept';

/**
 * Client reviews of delivered bookings (ADR-0027 D4): one CLIENT_TO_PRO review per booking,
 * editable for 7 days, comment published without contact details. Every write emits a
 * `review.*` outbox event in its transaction; the photographers module recomputes the rating
 * from its own subscriber. The moderation desk hides or keeps a review through `hide` / `keep`,
 * inside the decision's transaction.
 */
@Injectable()
export class BookingReviewsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(ReviewsRepository) private readonly repo: ReviewsRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(ReportsReader) private readonly reports: ReportsReader,
  ) {}

  /** The client's review of their own booking; null before they write one. */
  async mine(userId: string, bookingId: string): Promise<ReviewRecord | null> {
    if (!(await this.bookings.findForUser(userId, bookingId))) throw bookingNotFound();
    return this.repo.clientReviewOf(this.sql, bookingId);
  }

  /**
   * Writes the review, or edits it within the window. An unchanged edit writes nothing. Never
   * while a report on it is open, or once staff kept it: the author cannot swap the text under
   * the moderation desk (the report also keeps what it said when filed).
   */
  async save(userId: string, bookingId: string, body: ReviewBody, now: Date) {
    const booking = await this.bookings.findForUser(userId, bookingId);
    if (!booking) throw bookingNotFound();
    if (!isReviewable(booking.status)) throw notDeliveredYet();
    const rating = body.rating;
    const comment = cleanComment(body.comment);
    return this.sql.begin(async (tx) => {
      // One writer per booking: the first write and an edit never race each other.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`review:${bookingId}`}))`;
      const existing = await this.repo.lockClientReview(tx, bookingId);
      if (!existing) return this.submit(tx, bookingId, rating, comment, now);
      if (!existing.isPublished) throw reviewHidden();
      if (existing.moderatedBy !== null) throw reviewModerated();
      if (await this.reports.hasOpenReport(tx, 'REVIEW', existing.id)) {
        throw reviewUnderModeration();
      }
      if (!canEditReview(existing.createdAt, now)) throw editWindowClosed();
      if (existing.rating === rating && existing.comment === comment) return existing;
      const edited = await this.repo.edit(tx, existing.id, { rating, comment, at: now });
      if (!edited) throw reviewHidden();
      await this.emit(tx, 'review.edited', edited, now, { previous_rating: existing.rating });
      return edited;
    }) as Promise<ReviewRecord>;
  }

  /** A review a report names; null when it does not exist. */
  find(reviewId: string): Promise<ReviewRecord | null> {
    return this.repo.byId(this.sql, reviewId);
  }

  /**
   * The review as a report snapshots it, held FOR SHARE in the report's transaction: an edit
   * waits for the report to commit, then sees it open and is refused.
   */
  forReport(tx: Tx, reviewId: string): Promise<ReviewRecord | null> {
    return this.repo.shareById(tx, reviewId);
  }

  /** Moderation HIDE: unpublished, so it stops counting. Returns the review before and after. */
  async hide(tx: Tx, m: ReviewModeration): Promise<{ before: ReviewRecord; after: ReviewRecord }> {
    const before = await this.repo.lockById(tx, m.reviewId);
    if (!before) throw reviewNotFound();
    const after = await this.repo.moderate(tx, m.reviewId, {
      published: false,
      staffId: m.staffId,
      note: m.note,
    });
    await this.emit(tx, 'review.hidden', after, m.now, { was_published: before.isPublished });
    return { before, after };
  }

  /** Moderation KEEP: stays as it is, with who looked at it and why. */
  async keep(tx: Tx, m: ReviewModeration): Promise<{ before: ReviewRecord; after: ReviewRecord }> {
    const before = await this.repo.lockById(tx, m.reviewId);
    if (!before) throw reviewNotFound();
    const after = await this.repo.moderate(tx, m.reviewId, {
      published: before.isPublished,
      staffId: m.staffId,
      note: m.note,
    });
    await this.emit(tx, 'review.kept', after, m.now, {});
    return { before, after };
  }

  private async submit(
    tx: Tx,
    bookingId: string,
    rating: number,
    comment: string | null,
    now: Date,
  ): Promise<ReviewRecord> {
    const photographerId = await this.photographerOf(bookingId);
    const created = await this.repo.insertClientReview(tx, {
      bookingId,
      photographerId,
      rating,
      comment,
      at: now,
    });
    await this.emit(tx, 'review.submitted', created, now, {});
    return created;
  }

  /** The photographer who shot it: the booking's latest assignment, checked out. */
  private async photographerOf(bookingId: string): Promise<string> {
    const latest = (await this.assignments.latestForBookings([bookingId])).get(bookingId);
    if (latest?.status !== 'COMPLETED') throw notDeliveredYet();
    return latest.photographerId;
  }

  private emit(
    tx: Tx,
    eventType: ReviewEvent,
    r: ReviewRecord,
    now: Date,
    extra: Readonly<Record<string, number | boolean>>,
  ): Promise<void> {
    return appendDomainEvent(tx, {
      eventType,
      aggregateKind: 'review',
      aggregateId: r.id,
      occurredAt: now,
      payload: {
        review_id: r.id,
        booking_id: r.bookingId,
        photographer_id: r.photographerId,
        direction: r.direction,
        rating: r.rating,
        is_published: r.isPublished,
        ...extra,
      },
    });
  }
}
