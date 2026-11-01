'use client';

import type { AdminModerationDetail, AdminModerationItem } from '@clickco/contracts';
import { SideSheet, Skeleton } from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../../shared/api';
import { describeError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import {
  ConfirmDecision,
  DecisionButton,
  DecisionFields,
  type DecisionForm,
  useDecisionForm,
} from './decision-form';
import { moderationKeys, REASON_LABEL, reportedLabel } from './labels';
import { HistorySection, PersonSection, ReportSummary, ReviewSection } from './report-sections';

/**
 * One report over the list: what was reported and why, the review, the person and their record,
 * past decisions on the same target, and — while it is open — the decision that closes it.
 */
export function ReportSheet({
  item,
  onClose,
}: {
  readonly item: AdminModerationItem;
  readonly onClose: () => void;
}) {
  const query = useQuery({
    queryKey: moderationKeys.one(item.id),
    queryFn: () => adminApi.moderation.reports.get(item.id),
  });
  const detail = query.data;
  const form = useDecisionForm(item, onClose);
  const decidable = detail !== undefined && detail.allowedDecisions.length > 0;

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open || form.decide.isPending ? undefined : onClose())}
      size="lg"
      title={reportedLabel(item)}
      description={`${REASON_LABEL[item.reason]} · ${item.cityName} · reported ${formatDateTime(item.createdAt)}`}
      footer={decidable ? <DecisionButton form={form} /> : undefined}
    >
      {query.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError || !detail ? (
        <p role="alert" className="text-destructive text-sm">
          {describeError(query.error).message}
        </p>
      ) : (
        <ReportBody detail={detail} form={form} decidable={decidable} />
      )}
    </SideSheet>
  );
}

function ReportBody({
  detail,
  form,
  decidable,
}: {
  readonly detail: AdminModerationDetail;
  readonly form: DecisionForm;
  readonly decidable: boolean;
}) {
  return (
    <>
      <ReportSummary detail={detail} />
      {detail.review ? (
        <ReviewSection review={detail.review} reported={detail.reportedReview} />
      ) : null}
      {detail.person ? <PersonSection person={detail.person} /> : null}
      <HistorySection history={detail.history} />
      {decidable ? <DecisionFields form={form} detail={detail} /> : null}
      <ConfirmDecision form={form} detail={detail} />
    </>
  );
}
