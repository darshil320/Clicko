'use client';

import {
  type AdminApplicationDetail,
  AdminMoveApplicationBody,
  type ApplicationStage,
  missingVerification,
  SUPPLY_ACTION_ROLES,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  ExternalLinkIcon,
  Field,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SideSheet,
  Skeleton,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { describeError } from '../../shared/errors';
import { formatDateTime, formatPhone } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { safeHref } from '../../shared/safe-href';
import { useCan } from '../../shared/use-can';
import {
  DOC_LABEL,
  DOC_STATUS,
  moveTargets,
  SOURCE_LABEL,
  STAGE_LABEL,
  supplyKeys,
} from './labels';
import { VerificationList } from './verification-list';

const FORM_ID = 'move-application';

function consequence(a: AdminApplicationDetail, to: ApplicationStage): string {
  if (to === 'APPROVED') {
    return `${a.fullName} becomes an active photographer in ${a.cityName} and starts getting shoot offers.`;
  }
  if (to === 'REJECTED') return `${a.fullName}'s application closes. You can reopen it later.`;
  if (to === 'WITHDRAWN') return `${a.fullName}'s application closes as withdrawn.`;
  return `${a.fullName} moves to "${STAGE_LABEL[to]}".`;
}

/** One applicant: who they are, their documents and checks, the history, and the next move. */
export function ApplicationSheet({
  applicationId,
  onClose,
}: {
  readonly applicationId: string;
  readonly onClose: () => void;
}) {
  const query = useQuery({
    queryKey: supplyKeys.application(applicationId),
    queryFn: () => adminApi.supply.applications.get(applicationId),
  });
  const a = query.data;
  const canMove = useCan(SUPPLY_ACTION_ROLES.moveApplication);
  const canDecide = useCan(SUPPLY_ACTION_ROLES.decideApplication);
  const targets = a && canMove(a.cityId) ? moveTargets(a.stage, canDecide(a.cityId)) : [];

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="lg"
      title={a?.fullName ?? 'Applicant'}
      description={
        a
          ? `${STAGE_LABEL[a.stage]} · ${a.cityName} · applied ${formatDateTime(a.createdAt)}`
          : undefined
      }
      footer={
        targets.length > 0 ? (
          <Button type="submit" form={FORM_ID}>
            Move…
          </Button>
        ) : undefined
      }
    >
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError || !a ? (
        <p role="alert" className="text-destructive text-sm">
          {describeError(query.error).message}
        </p>
      ) : (
        <ApplicationBody a={a} targets={targets} onClose={onClose} />
      )}
    </SideSheet>
  );
}

function ApplicationBody({
  a,
  targets,
  onClose,
}: {
  readonly a: AdminApplicationDetail;
  readonly targets: readonly ApplicationStage[];
  readonly onClose: () => void;
}) {
  const [to, setTo] = useState<ApplicationStage | ''>('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const check = AdminMoveApplicationBody.safeParse({ toStage: to, note });
  const missing = missingVerification(a.verification);
  const move = useAdminMutation({
    run: (vars: AdminMoveApplicationBody, idem) =>
      adminApi.supply.applications.move(a.id, vars, idem),
    success: (vars) => `${a.fullName} moved to ${STAGE_LABEL[vars.toStage]}`,
    invalidate: [['supply']],
    onSuccess: onClose,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) setConfirming(true);
  };

  return (
    <>
      <DescriptionList>
        <DescriptionItem term="Phone">{formatPhone(a.phone)}</DescriptionItem>
        <DescriptionItem term="Came through">
          {a.source ? (SOURCE_LABEL[a.source as keyof typeof SOURCE_LABEL] ?? a.source) : '—'}
        </DescriptionItem>
        <DescriptionItem term="Experience">
          {a.yearsExperience === null ? '—' : `${a.yearsExperience} years`}
        </DescriptionItem>
        <DescriptionItem term="Portfolio">
          {safeHref(a.portfolioUrl, true) ? (
            <a
              href={safeHref(a.portfolioUrl, true) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
            >
              Open portfolio
              <ExternalLinkIcon className="size-4" />
            </a>
          ) : (
            '—'
          )}
        </DescriptionItem>
      </DescriptionList>
      {a.stage === 'APPROVED' ? (
        <p className="text-sm">
          Onboarded.{' '}
          <Link
            className="font-semibold underline-offset-4 hover:underline"
            href={`/photographers/${a.photographerId}`}
          >
            Open their profile
          </Link>
        </p>
      ) : null}
      <SectionHeader
        title="Checks before onboarding"
        description={
          missing.length === 0
            ? 'All four done — ready to approve.'
            : 'Approve the documents in "Documents to check".'
        }
      />
      <VerificationList v={a.verification} />
      <SectionHeader title="Documents" />
      {a.documents.length === 0 ? (
        <p className="text-muted-foreground text-sm">No documents uploaded yet.</p>
      ) : (
        <ul className="grid gap-2">
          {a.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {DOC_LABEL[d.kind]}
                {d.referenceMasked ? (
                  <span className="text-muted-foreground"> {d.referenceMasked}</span>
                ) : null}
              </span>
              <Badge variant={DOC_STATUS[d.reviewStatus].tone}>
                {DOC_STATUS[d.reviewStatus].label}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {targets.length > 0 ? (
        <form
          id={FORM_ID}
          className="grid gap-4 rounded-md border p-4"
          onSubmit={submit}
          noValidate
        >
          <Field
            label="Move to"
            htmlFor="move-to"
            error={touched ? fieldError(check, 'toStage') && 'Pick a stage' : null}
          >
            <Select value={to} onValueChange={(v) => setTo(v as ApplicationStage)}>
              <SelectTrigger id="move-to">
                <SelectValue placeholder="Pick the next stage" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((t) => (
                  <SelectItem key={t} value={t}>
                    {STAGE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <NoteField
            id="move-note"
            label="Why"
            required
            hint="Saved with the move, for whoever picks this up next."
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
        </form>
      ) : null}
      <SectionHeader title="History" />
      <ol className="grid gap-3">
        {[...a.history].reverse().map((h) => (
          <li key={`${h.at}-${h.toStage}`} className="grid gap-0.5 border-l-2 pl-3 text-sm">
            <span className="font-medium">
              {h.fromStage ? `${STAGE_LABEL[h.fromStage]} → ` : ''}
              {STAGE_LABEL[h.toStage]}
            </span>
            {h.note ? <span>{h.note}</span> : null}
            <span className="text-muted-foreground text-xs">
              {h.actorName ?? 'System'} · {formatDateTime(h.at)}
            </span>
          </li>
        ))}
      </ol>
      {confirming && check.success ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirming}
          title={`Move ${a.fullName} to "${STAGE_LABEL[check.data.toStage]}"?`}
          consequence={consequence(a, check.data.toStage)}
          confirmLabel={check.data.toStage === 'APPROVED' ? 'Onboard photographer' : 'Move'}
          destructive={check.data.toStage === 'REJECTED'}
          pending={move.isPending}
          onConfirm={() => move.mutate(check.data)}
        />
      ) : null}
    </>
  );
}
