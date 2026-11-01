'use client';

import type {
  AdminModerationAction,
  AdminModerationDetail,
  AdminModerationPerson,
  AdminModerationReported,
  AdminModerationReview,
} from '@clickco/contracts';
import { Badge, DescriptionItem, DescriptionList, SectionHeader } from '@clickco/ui-web';
import { BookingLink, Muted } from '../../shared/cells';
import { formatDateTime } from '../../shared/format';
import {
  changedSinceReport,
  DECISION,
  openReportsLabel,
  PERSON_KIND_LABEL,
  REASON_LABEL,
  reportsClosedLabel,
  STATUS,
  starsLabel,
  warningsLabel,
} from './labels';

/** The report itself: who reported it, why, about which booking, and how it was decided. */
export function ReportSummary({ detail: d }: { readonly detail: AdminModerationDetail }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Badge variant={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
        {d.decision ? <Badge variant="outline">{DECISION[d.decision].done}</Badge> : null}
      </div>
      <DescriptionList>
        <DescriptionItem term="Reported by">
          {d.reporterName ?? 'Name not known'} · {PERSON_KIND_LABEL[d.reporterKind]}
        </DescriptionItem>
        <DescriptionItem term="Reason">{REASON_LABEL[d.reason]}</DescriptionItem>
        <DescriptionItem term="Booking">
          {d.bookingId && d.bookingReference ? (
            <BookingLink id={d.bookingId} reference={d.bookingReference} />
          ) : (
            'None'
          )}
        </DescriptionItem>
        <DescriptionItem term="Reported">{formatDateTime(d.createdAt)}</DescriptionItem>
        {d.status === 'OPEN' ? (
          <DescriptionItem term="Other open reports on this">
            {openReportsLabel(d.otherOpenReports)}
          </DescriptionItem>
        ) : null}
        {d.note ? (
          <DescriptionItem term="What they wrote" className="sm:col-span-2">
            {d.note}
          </DescriptionItem>
        ) : null}
        {d.decision ? (
          <>
            <DescriptionItem term="Decided by">
              {d.decidedByName ?? 'Staff'}
              {d.decidedAt ? ` · ${formatDateTime(d.decidedAt)}` : ''}
            </DescriptionItem>
            <DescriptionItem term="Decision note" className="sm:col-span-2">
              {d.decisionNote ?? '—'}
            </DescriptionItem>
          </>
        ) : null}
      </DescriptionList>
    </>
  );
}

/** A review's comment, or a line saying there is none. */
function CommentText({ comment }: { readonly comment: string | null }) {
  return comment ? (
    <p className="whitespace-pre-line rounded-md border bg-muted p-3 text-sm">{comment}</p>
  ) : (
    <p className="text-sm">
      <Muted>No comment — only the rating.</Muted>
    </p>
  );
}

/**
 * The reported review as the client wrote it; stars as words, shown or hidden as a word. When it
 * differs from what was reported, what was reported is shown too: decide on that.
 */
export function ReviewSection({
  review: r,
  reported,
}: {
  readonly review: AdminModerationReview;
  readonly reported: AdminModerationReported | null;
}) {
  return (
    <>
      <SectionHeader title="The review" />
      <DescriptionList>
        <DescriptionItem term="Rating">{starsLabel(r.rating)}</DescriptionItem>
        <DescriptionItem term="In the app">
          <Badge variant={r.isPublished ? 'success' : 'neutral'}>
            {r.isPublished ? 'Shown' : 'Hidden'}
          </Badge>
        </DescriptionItem>
        <DescriptionItem term="Written by">{r.authorName ?? 'Name not known'}</DescriptionItem>
        <DescriptionItem term="About">{r.photographerName ?? '—'}</DescriptionItem>
        <DescriptionItem term="Written">{formatDateTime(r.createdAt)}</DescriptionItem>
      </DescriptionList>
      <CommentText comment={r.comment} />
      {reported && changedSinceReport(r, reported) ? (
        <>
          <SectionHeader
            title="When it was reported"
            description="The review has changed since. This is what was reported."
          />
          <DescriptionList>
            <DescriptionItem term="Rating">{starsLabel(reported.rating)}</DescriptionItem>
          </DescriptionList>
          <CommentText comment={reported.comment} />
        </>
      ) : null}
    </>
  );
}

/** The person a warning goes to, and their record so far. */
export function PersonSection({ person: p }: { readonly person: AdminModerationPerson }) {
  return (
    <>
      <SectionHeader
        title={p.name ?? 'The person'}
        description={`${PERSON_KIND_LABEL[p.kind]} — a warning goes on their record.`}
      />
      <DescriptionList>
        <DescriptionItem term="Warnings so far">{warningsLabel(p.warnings)}</DescriptionItem>
        <DescriptionItem term="Open reports against them">
          {openReportsLabel(p.openReports)}
        </DescriptionItem>
      </DescriptionList>
    </>
  );
}

/** Earlier decisions on the same target. */
export function HistorySection({
  history,
}: {
  readonly history: ReadonlyArray<AdminModerationAction>;
}) {
  return (
    <>
      <SectionHeader title="Past decisions" />
      {history.length === 0 ? (
        <p className="text-sm">
          <Muted>No decisions on this before.</Muted>
        </p>
      ) : (
        <ol className="grid gap-3">
          {history.map((h) => (
            <li
              key={`${h.decidedAt}-${h.decision}`}
              className="grid gap-0.5 border-l-2 pl-3 text-sm"
            >
              <span className="font-medium">{DECISION[h.decision].done}</span>
              <span>{h.note}</span>
              <span className="text-muted-foreground text-xs">
                {h.staffName ?? 'Staff'} · {formatDateTime(h.decidedAt)} ·{' '}
                {reportsClosedLabel(h.reportsClosed)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
