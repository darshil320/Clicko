import { z } from 'zod';
import { AdminListQuery, AdminPage } from './admin.js';
import { IsoDateTime, Uuid } from './common.js';
import {
  ReporterKind,
  ReportReason,
  ReportStatus,
  ReportTargetKind,
  ReviewRating,
} from './reviews.js';

/**
 * ADR-0027 D4 — the moderation desk: reports of reviews, clients and photographers, decided by
 * the Quality Manager, support or the city manager. HIDE unpublishes a reported review (it stops
 * counting in the photographer's rating); KEEP leaves it up; WARN records a warning against the
 * person (a review's author, or the reported client or photographer); DISMISS closes a report
 * that needs nothing. A decision closes every open report on the same target in the caller's
 * cities.
 */

export const ModerationDecision = z.enum(['HIDE', 'KEEP', 'WARN', 'DISMISS']);
export type ModerationDecision = z.infer<typeof ModerationDecision>;

/** HIDE and WARN act on the target (ACTIONED); KEEP and DISMISS do not (DISMISSED). */
export function reportStatusAfter(decision: ModerationDecision): ReportStatus {
  return decision === 'HIDE' || decision === 'WARN' ? 'ACTIONED' : 'DISMISSED';
}

export const AdminModerationFilter = z.enum(['OPEN', 'DECIDED', 'ALL']);
export type AdminModerationFilter = z.infer<typeof AdminModerationFilter>;

/** GET /admin/moderation/reports — OPEN oldest first (default); DECIDED and ALL newest first. */
export const AdminModerationQuery = AdminListQuery.extend({
  status: AdminModerationFilter.default('OPEN'),
});
export type AdminModerationQuery = z.input<typeof AdminModerationQuery>;

export const AdminModerationItem = z.object({
  id: Uuid,
  targetKind: ReportTargetKind,
  targetId: Uuid,
  /** The reported person, or for a review the photographer it is about. */
  targetName: z.string().nullable(),
  reason: ReportReason,
  note: z.string().nullable(),
  reporterKind: ReporterKind,
  reporterName: z.string().nullable(),
  cityName: z.string(),
  bookingId: Uuid.nullable(),
  bookingReference: z.string().nullable(),
  status: ReportStatus,
  decision: ModerationDecision.nullable(),
  decisionNote: z.string().nullable(),
  decidedByName: z.string().nullable(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
});
export type AdminModerationItem = z.infer<typeof AdminModerationItem>;

export const AdminModerationPage = AdminPage(AdminModerationItem);
export type AdminModerationPage = z.infer<typeof AdminModerationPage>;

/** The reported review, as the client wrote it (links and phone numbers already removed). */
export const AdminModerationReview = z.object({
  id: Uuid,
  rating: ReviewRating,
  comment: z.string().nullable(),
  isPublished: z.boolean(),
  photographerId: Uuid.nullable(),
  photographerName: z.string().nullable(),
  authorName: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AdminModerationReview = z.infer<typeof AdminModerationReview>;

/** A REVIEW report: the review as it stood when the report was filed (edits cannot hide it). */
export const AdminModerationReported = z.object({
  rating: ReviewRating,
  comment: z.string().nullable(),
});
export type AdminModerationReported = z.infer<typeof AdminModerationReported>;

/** Who a warning would go to, and their record so far. */
export const AdminModerationPerson = z.object({
  kind: ReporterKind,
  id: Uuid,
  name: z.string().nullable(),
  warnings: z.int().min(0),
  openReports: z.int().min(0),
});
export type AdminModerationPerson = z.infer<typeof AdminModerationPerson>;

/** One past decision on the same target. */
export const AdminModerationAction = z.object({
  decision: ModerationDecision,
  note: z.string(),
  staffName: z.string().nullable(),
  reportsClosed: z.int().min(0),
  decidedAt: IsoDateTime,
});
export type AdminModerationAction = z.infer<typeof AdminModerationAction>;

export const AdminModerationDetail = AdminModerationItem.extend({
  /** Set for a REVIEW report: the review now. */
  review: AdminModerationReview.nullable(),
  /** Set for a REVIEW report: the review as it stood when this report was filed. */
  reportedReview: AdminModerationReported.nullable(),
  /** The person WARN would warn (a review's author; the reported client or photographer). */
  person: AdminModerationPerson.nullable(),
  /** Other reports still open on the same target (closed together with this one). */
  otherOpenReports: z.int().min(0),
  history: z.array(AdminModerationAction),
  /** What this report can still be decided as ([] once decided; HIDE only for a shown review). */
  allowedDecisions: z.array(ModerationDecision),
});
export type AdminModerationDetail = z.infer<typeof AdminModerationDetail>;

/** POST /admin/moderation/reports/:id/decide */
export const AdminModerationDecisionBody = z.object({
  decision: ModerationDecision,
  note: z.string().trim().min(3, 'Add a short note for the record').max(1_000),
});
export type AdminModerationDecisionBody = z.infer<typeof AdminModerationDecisionBody>;
