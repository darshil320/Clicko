import type {
  ModerationDecision,
  ReporterKind,
  ReportStatus,
  ReportTargetKind,
} from '@clickco/contracts';

/** ADR-0027 D4 limits for reports and blocks. */
export const SAFETY_CONFIG = {
  /** Per IP on the report routes, on top of the global backstop. */
  reportsPerMinutePerIp: 10,
  /** Per reporter (shared across instances: counted in Postgres). */
  reportsPerReporterPerDay: 10,
  /** Per IP on block / unblock. */
  blockWritesPerMinutePerIp: 30,
} as const;

/**
 * Anyone may report a review; a client reports a photographer and a photographer a client (the
 * only people each meets through Clickco).
 */
export function reportTargetAllowed(reporter: ReporterKind, target: ReportTargetKind): boolean {
  if (target === 'REVIEW') return true;
  return reporter === 'USER' ? target === 'PHOTOGRAPHER' : target === 'USER';
}

/**
 * What an OPEN report can be decided as. HIDE and KEEP are about a review that is still shown;
 * WARN goes to a person; DISMISS always fits. A decided report has nothing left.
 */
export function allowedDecisions(
  report: { readonly status: ReportStatus; readonly targetKind: ReportTargetKind },
  review: { readonly isPublished: boolean } | null,
): ModerationDecision[] {
  if (report.status !== 'OPEN') return [];
  const shown = report.targetKind === 'REVIEW' && review?.isPublished === true;
  return shown ? ['HIDE', 'KEEP', 'WARN', 'DISMISS'] : ['WARN', 'DISMISS'];
}

/** Who WARN warns: a review's author (a client), or the reported client or photographer. */
export function personWarned(
  report: { readonly targetKind: ReportTargetKind; readonly targetId: string },
  reviewAuthorId: string | null,
): { readonly kind: ReporterKind; readonly id: string } | null {
  if (report.targetKind === 'REVIEW') {
    return reviewAuthorId ? { kind: 'USER', id: reviewAuthorId } : null;
  }
  return { kind: report.targetKind, id: report.targetId };
}
