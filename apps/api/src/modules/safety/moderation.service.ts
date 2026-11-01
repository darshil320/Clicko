import { type ModerationDecision, reportStatusAfter } from '@clickco/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { TxHook } from '../../common/tx-hook';
import { SQL } from '../../infra/db/db.module';
import { appendDomainEvent } from '../../infra/outbox/outbox';
import { BookingsService } from '../bookings/bookings.service';
import { BookingReviewsService } from '../reviews/reviews.service';
import type { ReviewRecord } from '../reviews/reviews.types';
import { decisionNotAllowed, reportAlreadyDecided, reportNotFound } from './http-errors';
import { ModerationActionsRepository } from './repositories/moderation-actions.repository';
import { ReportsRepository } from './repositories/reports.repository';
import type {
  ModerationActionRecord,
  Reporter,
  ReportPageQuery,
  ReportRecord,
  ReportScope,
  Tx,
} from './safety.types';
import { allowedDecisions, personWarned } from './safety-rules';

/** Everything the moderation desk shows about one report. */
export interface ModerationFacts {
  readonly report: ReportRecord;
  readonly review: ReviewRecord | null;
  /** The person WARN would warn, with their record so far. */
  readonly person: (Reporter & { readonly warnings: number; readonly openReports: number }) | null;
  /** Open reports on the same target in scope, this one excluded. */
  readonly otherOpenReports: number;
  readonly history: readonly ModerationActionRecord[];
  readonly allowedDecisions: readonly ModerationDecision[];
}

export interface Decision {
  readonly reportId: string;
  readonly decision: ModerationDecision;
  readonly note: string;
  readonly staffId: string;
  readonly scope: ReportScope;
  readonly now: Date;
  /** The admin audit row, written inside the decision's transaction. */
  readonly audit: TxHook;
}

/**
 * The moderation desk's domain side (ADR-0027 D4). A decision closes every OPEN report on the
 * same target in the caller's cities, appends one moderation_actions row, hides or keeps a
 * reported review through the reviews module, and emits `report.decided` (plus
 * `moderation.warning_issued` for WARN) — with the audit row — in one transaction.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(ReportsRepository) private readonly reports: ReportsRepository,
    @Inject(ModerationActionsRepository) private readonly actions: ModerationActionsRepository,
    @Inject(BookingReviewsService) private readonly reviews: BookingReviewsService,
    @Inject(BookingsService) private readonly bookings: BookingsService,
  ) {}

  page(q: ReportPageQuery): Promise<ReportRecord[]> {
    return this.reports.page(this.sql, q);
  }

  countOpen(scope: ReportScope): Promise<number> {
    return this.reports.countOpen(this.sql, scope);
  }

  /** The reviews a page of REVIEW reports names, by id (for the photographer's name). */
  async reviewsOf(reviewIds: readonly string[]): Promise<Map<string, ReviewRecord>> {
    const unique = [...new Set(reviewIds)];
    const found = await Promise.all(unique.map((id) => this.reviews.find(id)));
    return new Map(found.flatMap((r) => (r ? [[r.id, r] as const] : [])));
  }

  /** 404 when the report is missing or outside the caller's cities. */
  async facts(reportId: string, scope: ReportScope): Promise<ModerationFacts> {
    const report = await this.reports.find(this.sql, reportId, scope);
    if (!report) throw reportNotFound();
    const review = report.targetKind === 'REVIEW' ? await this.reviews.find(report.targetId) : null;
    const target = personWarned(report, review ? await this.authorOf(review) : null);
    const [warnings, openOnPerson, openOnTarget, history] = await Promise.all([
      target ? this.actions.warningsFor(this.sql, target.kind, target.id, scope) : 0,
      target ? this.reports.countOpenOnTarget(this.sql, target.kind, target.id, scope) : 0,
      this.reports.countOpenOnTarget(this.sql, report.targetKind, report.targetId, scope),
      this.actions.forTarget(this.sql, report.targetKind, report.targetId, scope),
    ]);
    return {
      report,
      review,
      person: target ? { ...target, warnings, openReports: openOnPerson } : null,
      otherOpenReports: Math.max(0, openOnTarget - (report.status === 'OPEN' ? 1 : 0)),
      history,
      allowedDecisions: allowedDecisions(report, review),
    };
  }

  async decide(d: Decision): Promise<void> {
    // Read the target first, then serialise every decision on it (no deadlock between two
    // reports of the same target closing each other), then lock and re-check this report.
    const peek = await this.reports.find(this.sql, d.reportId, d.scope);
    if (!peek) throw reportNotFound();
    await this.sql.begin(async (tx) => {
      const key = `moderation:${peek.targetKind}:${peek.targetId}`;
      await tx`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const report = await this.reports.lock(tx, d.reportId, d.scope);
      if (!report) throw reportNotFound();
      if (report.status !== 'OPEN') throw reportAlreadyDecided();
      await this.apply(tx, report, d);
    });
  }

  private async apply(tx: Tx, report: ReportRecord, d: Decision): Promise<void> {
    const review = report.targetKind === 'REVIEW' ? await this.reviews.find(report.targetId) : null;
    const allowed = allowedDecisions(report, review);
    if (!allowed.includes(d.decision)) throw decisionNotAllowed(allowed);
    const reviewChange = review ? await this.applyToReview(tx, review, d) : null;
    const warned =
      d.decision === 'WARN'
        ? personWarned(report, review ? await this.authorOf(review) : null)
        : null;
    if (d.decision === 'WARN' && !warned) throw decisionNotAllowed(allowed);
    const status = reportStatusAfter(d.decision);
    const closed = await this.reports.closeOpenOnTarget(tx, {
      targetKind: report.targetKind,
      targetId: report.targetId,
      scope: d.scope,
      status,
      decision: d.decision,
      note: d.note,
      staffId: d.staffId,
      at: d.now,
    });
    await this.actions.insert(tx, {
      reportId: report.id,
      decision: d.decision,
      targetKind: report.targetKind,
      targetId: report.targetId,
      warnedKind: warned?.kind ?? null,
      warnedId: warned?.id ?? null,
      staffId: d.staffId,
      cityId: report.cityId,
      note: d.note,
      reportsClosed: closed.length,
      createdAt: d.now,
    });
    await this.emitDecided(tx, report, d, closed, warned);
    await d.audit(tx, {
      before: {
        status: report.status,
        ...(reviewChange ? { review_published: reviewChange.before.isPublished } : {}),
      },
      after: {
        status,
        decision: d.decision,
        note: d.note,
        target_kind: report.targetKind,
        target_id: report.targetId,
        reports_closed: closed,
        ...(reviewChange ? { review_published: reviewChange.after.isPublished } : {}),
        ...(warned ? { warned_kind: warned.kind, warned_id: warned.id } : {}),
      },
    });
  }

  /** HIDE unpublishes the review; KEEP records that staff looked; WARN / DISMISS leave it. */
  private applyToReview(tx: Tx, review: ReviewRecord, d: Decision) {
    const m = { reviewId: review.id, staffId: d.staffId, note: d.note, now: d.now };
    if (d.decision === 'HIDE') return this.reviews.hide(tx, m);
    if (d.decision === 'KEEP') return this.reviews.keep(tx, m);
    return null;
  }

  private async emitDecided(
    tx: Tx,
    report: ReportRecord,
    d: Decision,
    closed: readonly string[],
    warned: Reporter | null,
  ): Promise<void> {
    await appendDomainEvent(tx, {
      eventType: 'report.decided',
      aggregateKind: 'moderation_report',
      aggregateId: report.id,
      occurredAt: d.now,
      payload: {
        report_id: report.id,
        decision: d.decision,
        status: reportStatusAfter(d.decision),
        target_kind: report.targetKind,
        target_id: report.targetId,
        closed_report_ids: [...closed],
      },
    });
    if (!warned) return;
    await appendDomainEvent(tx, {
      eventType: 'moderation.warning_issued',
      aggregateKind: warned.kind === 'USER' ? 'user' : 'photographer',
      aggregateId: warned.id,
      occurredAt: d.now,
      payload: {
        report_id: report.id,
        warned_kind: warned.kind,
        warned_id: warned.id,
        reason: report.reason,
        target_kind: report.targetKind,
        target_id: report.targetId,
      },
    });
  }

  /** A CLIENT_TO_PRO review's author is the booking's client. */
  private async authorOf(review: ReviewRecord): Promise<string | null> {
    if (review.direction !== 'CLIENT_TO_PRO') return null;
    return (await this.bookings.deliveryFacts(this.sql, review.bookingId)).userId;
  }
}
