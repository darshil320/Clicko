'use client';

import {
  AdminModerationDecisionBody,
  type AdminModerationDetail,
  type AdminModerationItem,
  ModerationDecision,
} from '@clickco/contracts';
import {
  Button,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';
import {
  DECISION,
  decidedNotice,
  decisionConsequence,
  moderationKeys,
  reportedLabel,
} from './labels';

const FORM_ID = 'moderation-decision';

/** The plain-words consequence of `decision` on this report, with its names. */
function consequenceFor(d: AdminModerationDetail, decision: ModerationDecision): string {
  return decisionConsequence({
    decision,
    targetKind: d.targetKind,
    authorName: d.review?.authorName ?? null,
    photographerName: d.review?.photographerName ?? d.targetName,
    personName: d.person?.name ?? null,
    personWarnings: d.person?.warnings ?? 0,
    otherOpenReports: d.otherOpenReports,
  });
}

/**
 * The decision on one report: its fields, the one Idempotency-Key per intent (useAdminMutation),
 * and the confirm step for HIDE and WARN. KEEP and DISMISS go straight through.
 */
export function useDecisionForm(item: AdminModerationItem, onDone: () => void) {
  const [decision, setDecision] = useState<ModerationDecision | ''>('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const check = AdminModerationDecisionBody.safeParse({ decision, note });

  const decide = useAdminMutation({
    run: (vars: AdminModerationDecisionBody, idem) =>
      adminApi.moderation.reports.decide(item.id, vars, idem),
    success: (vars) => decidedNotice(vars.decision, reportedLabel(item)),
    invalidate: [moderationKeys.all, keys.overview],
    onSuccess: onDone,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!check.success || decide.isPending) return;
    if (DECISION[check.data.decision].confirms) setConfirming(true);
    else decide.mutate(check.data);
  };

  return {
    decision,
    setDecision,
    note,
    setNote,
    touched,
    check,
    confirming,
    setConfirming,
    decide,
    submit,
  };
}

export type DecisionForm = ReturnType<typeof useDecisionForm>;

/** The sheet's one primary action, pinned in its footer; it submits the form below. */
export function DecisionButton({ form }: { readonly form: DecisionForm }) {
  const chosen = form.decision === '' ? null : DECISION[form.decision];
  const label = chosen ? `${chosen.action}${chosen.confirms ? '…' : ''}` : 'Decide';
  return (
    <Button type="submit" form={FORM_ID} disabled={form.decide.isPending}>
      {form.decide.isPending && !form.confirming ? <Spinner /> : null}
      {label}
    </Button>
  );
}

export function DecisionFields({
  form,
  detail,
}: {
  readonly form: DecisionForm;
  readonly detail: AdminModerationDetail;
}) {
  const { check, touched } = form;
  return (
    <form
      id={FORM_ID}
      className="grid gap-4 rounded-md border p-4"
      onSubmit={form.submit}
      noValidate
    >
      <Field
        label="Decision"
        htmlFor="moderation-decision-choice"
        hint={form.decision === '' ? undefined : consequenceFor(detail, form.decision)}
        error={touched && fieldError(check, 'decision') ? 'Choose a decision' : null}
      >
        <Select
          value={form.decision}
          onValueChange={(v) => form.setDecision(ModerationDecision.parse(v))}
        >
          <SelectTrigger id="moderation-decision-choice">
            <SelectValue placeholder="Choose a decision" />
          </SelectTrigger>
          <SelectContent>
            {detail.allowedDecisions.map((d) => (
              <SelectItem key={d} value={d}>
                {DECISION[d].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <NoteField
        id="moderation-note"
        label="Note for the record"
        required
        hint="Why you decided this — saved with the decision for the team."
        value={form.note}
        onChange={form.setNote}
        error={touched ? fieldError(check, 'note') : null}
      />
    </form>
  );
}

/** HIDE and WARN: what will happen, in plain words with names, before it happens. */
export function ConfirmDecision({
  form,
  detail,
}: {
  readonly form: DecisionForm;
  readonly detail: AdminModerationDetail;
}) {
  if (!form.confirming || !form.check.success) return null;
  const body = form.check.data;
  const title =
    body.decision === 'WARN' && detail.person?.name
      ? `Warn ${detail.person.name}`
      : DECISION[body.decision].label;
  return (
    <ConfirmDialog
      open
      onOpenChange={form.setConfirming}
      title={title}
      consequence={consequenceFor(detail, body.decision)}
      confirmLabel={DECISION[body.decision].action}
      destructive={body.decision === 'HIDE'}
      pending={form.decide.isPending}
      onConfirm={() => form.decide.mutate(body)}
    />
  );
}
