import type { ReportBody } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { AssignmentReads } from '../dispatch/assignment-reads.service';
import { BookingReviewsService } from '../reviews/reviews.service';
import {
  bookingNotFound,
  cannotReportYourself,
  photographerNotFound,
  reportAlreadyOpen,
  reportsRateLimited,
  reviewNotFound,
  targetNotAllowed,
} from './http-errors';
import { ReportsRepository } from './repositories/reports.repository';
import type { Reporter, ReportRecord, Tx } from './safety.types';
import { reportTargetAllowed, SAFETY_CONFIG } from './safety-rules';

const DAY_MS = 86_400_000;

/**
 * Where a report lands — the booking it is about and that booking's city (the desk's scope) —
 * and, for a review, what the review said when it was reported.
 */
interface ReportContext {
  readonly bookingId: string;
  readonly cityId: string;
  readonly reported: { readonly rating: number; readonly comment: string | null } | null;
}

/**
 * Clients and photographers report a review, or the person they shared a booking with
 * (ADR-0027 D4). Each report lands in its booking's city on the moderation desk. One OPEN report
 * per reporter and target. A daily cap per reporter, counted in the insert's transaction under a
 * per-reporter lock (two reports at once cannot both slip under it, on any instance). A review
 * report snapshots the review, holding it FOR SHARE so no edit lands in between.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(ReportsRepository) private readonly repo: ReportsRepository,
    @Inject(BookingsService) private readonly bookings: BookingsService,
    @Inject(AssignmentReads) private readonly assignments: AssignmentReads,
    @Inject(BookingReviewsService) private readonly reviews: BookingReviewsService,
  ) {}

  async open(reporter: Reporter, body: ReportBody, now: Date): Promise<ReportRecord> {
    if (!reportTargetAllowed(reporter.kind, body.targetKind)) throw targetNotAllowed();
    const person = body.targetKind === 'REVIEW' ? null : await this.personContext(reporter, body);
    return this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`reports:${reporter.kind}:${reporter.id}`}))`;
      const since = new Date(now.getTime() - DAY_MS);
      const today = await this.repo.countBySince(tx, reporter, since);
      if (today >= SAFETY_CONFIG.reportsPerReporterPerDay) throw reportsRateLimited();
      const context = person ?? (await this.reviewContext(tx, reporter, body.targetId));
      const report = await this.repo.insertOpen(tx, {
        reporter,
        targetKind: body.targetKind,
        targetId: body.targetId,
        bookingId: context.bookingId,
        cityId: context.cityId,
        reason: body.reason,
        note: body.note ? body.note : null,
        reported: context.reported,
        at: now,
      });
      if (!report) throw reportAlreadyOpen();
      await appendDomainEvent(tx, {
        eventType: 'report.opened',
        aggregateKind: 'moderation_report',
        aggregateId: report.id,
        occurredAt: now,
        payload: {
          report_id: report.id,
          reporter_kind: report.reporterKind,
          target_kind: report.targetKind,
          target_id: report.targetId,
          booking_id: report.bookingId,
          city_id: report.cityId,
          reason: report.reason,
        },
      });
      return report;
    }) as Promise<ReportRecord>;
  }

  /** The city a report belongs to, for the desk's @CityScoped routes; null when absent. */
  cityOf(reportId: string): Promise<string | null> {
    return this.repo.cityOf(this.sql, reportId);
  }

  /** A client or a photographer, reported about a booking the two shared. */
  private personContext(reporter: Reporter, body: ReportBody): Promise<ReportContext> {
    if (!body.bookingId) throw bookingNotFound(); // the contract requires it; defensive
    return body.targetKind === 'PHOTOGRAPHER'
      ? this.photographerContext(reporter, body.targetId, body.bookingId)
      : this.clientContext(reporter, body.targetId, body.bookingId);
  }

  /** A shown review, never your own — held FOR SHARE and snapshotted in the report's tx. */
  private async reviewContext(
    tx: Tx,
    reporter: Reporter,
    reviewId: string,
  ): Promise<ReportContext> {
    const review = await this.reviews.forReport(tx, reviewId);
    if (!review?.isPublished) throw reviewNotFound();
    const own =
      reporter.kind === 'USER'
        ? (await this.bookings.findForUser(reporter.id, review.bookingId)) !== null
        : review.direction === 'PRO_TO_CLIENT' && review.photographerId === reporter.id;
    if (own) throw cannotReportYourself();
    const cityId = await this.bookings.cityOf(review.bookingId);
    if (!cityId) throw reviewNotFound();
    return {
      bookingId: review.bookingId,
      cityId,
      reported: { rating: review.rating, comment: review.comment },
    };
  }

  /** A client reports the photographer who worked on (or was assigned to) their booking. */
  private async photographerContext(
    reporter: Reporter,
    photographerId: string,
    bookingId: string,
  ): Promise<ReportContext> {
    const booking = await this.bookings.findForUser(reporter.id, bookingId);
    if (!booking) throw bookingNotFound();
    if (!(await this.assignments.everAssigned(photographerId, [bookingId]))) {
      throw photographerNotFound();
    }
    return { bookingId, cityId: booking.cityId, reported: null };
  }

  /** A photographer reports the client whose booking they were assigned to. */
  private async clientContext(
    reporter: Reporter,
    userId: string,
    bookingId: string,
  ): Promise<ReportContext> {
    const booking = await this.bookings.findForUser(userId, bookingId);
    if (!booking || !(await this.assignments.everAssigned(reporter.id, [bookingId]))) {
      throw bookingNotFound();
    }
    return { bookingId, cityId: booking.cityId, reported: null };
  }
}
