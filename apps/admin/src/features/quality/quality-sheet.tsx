'use client';

import {
  type AdminQualityItem,
  AdminResolveQualityBody,
  CARE_ACTION_ROLES,
  isMoneyOutcome,
  QualityOutcome,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SideSheet,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink } from '../../shared/cells';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { formatDateTime, formatMoney } from '../../shared/format';
import { parseRupees } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { useCan } from '../../shared/use-can';
import { decisionConsequence, OUTCOME_LABEL, qualityKeys, STATUS } from './labels';

const FORM_ID = 'quality-decision';

/** One complaint: the details, and — for the QM — the decision that closes it. */
export function QualitySheet({
  issue,
  onClose,
}: {
  readonly issue: AdminQualityItem;
  readonly onClose: () => void;
}) {
  const canDecide = useCan(CARE_ACTION_ROLES.decideQuality)();
  const [current, setCurrent] = useState(issue);
  const pending = current.status === 'OPEN' || current.status === 'IN_REVIEW';
  const [outcome, setOutcome] = useState<QualityOutcome>('CREDIT');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const money = isMoneyOutcome(outcome);
  const amountPaise = money ? (parseRupees(amount) ?? 0) : undefined;
  const check = AdminResolveQualityBody.safeParse({
    outcome,
    ...(amountPaise === undefined ? {} : { amountPaise }),
    note,
  });

  const invalidate = [qualityKeys.all, keys.bookingAll, keys.bookingsAll];
  const take = useAdminMutation({
    run: (_: null, idem) => adminApi.care.quality.take(current.id, idem),
    success: () => `You are reviewing ${current.reference}`,
    invalidate,
    onSuccess: setCurrent,
  });
  const resolve = useAdminMutation({
    run: (vars: AdminResolveQualityBody, idem) =>
      adminApi.care.quality.resolve(current.id, vars, idem),
    success: (vars) =>
      `Decided: ${OUTCOME_LABEL[vars.outcome].toLowerCase()} for ${current.reference}`,
    invalidate,
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) setConfirming(true);
  };

  const decidable = canDecide && pending;
  return (
    <SideSheet
      open
      onOpenChange={(open) => (open || resolve.isPending ? undefined : onClose())}
      size="lg"
      title={`Quality issue on ${current.reference}`}
      description={`${current.clientName} · ${current.cityName} · raised ${formatDateTime(current.createdAt)}`}
      footer={
        decidable ? (
          current.status === 'OPEN' ? (
            <Button disabled={take.isPending} onClick={() => take.mutate(null)}>
              {take.isPending ? <Spinner /> : null}
              Start review
            </Button>
          ) : (
            <Button type="submit" form={FORM_ID} disabled={resolve.isPending}>
              Decide and close
            </Button>
          )
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant={STATUS[current.status].tone}>{STATUS[current.status].label}</Badge>
        {current.outcome ? <Badge variant="outline">{OUTCOME_LABEL[current.outcome]}</Badge> : null}
      </div>
      <p className="rounded-md border bg-muted p-3 text-sm">{current.complaint}</p>
      <DescriptionList>
        <DescriptionItem term="Booking">
          <BookingLink id={current.bookingId} reference={current.reference} />
        </DescriptionItem>
        <DescriptionItem term="Photographer">{current.photographerName ?? '—'}</DescriptionItem>
        <DescriptionItem term="Booking total">
          {formatMoney(current.bookingTotalPaise)}
        </DescriptionItem>
        <DescriptionItem term="Client has paid">
          {formatMoney(current.amountPaidPaise)}
        </DescriptionItem>
        <DescriptionItem term="Logged by">{current.raisedByName ?? 'The client'}</DescriptionItem>
        <DescriptionItem term="Quality Manager">
          {current.assignedQmName ?? 'Not picked up yet'}
        </DescriptionItem>
        {current.outcome ? (
          <>
            <DescriptionItem term="Decision">
              {OUTCOME_LABEL[current.outcome]}
              {current.remedyPaise > 0 ? ` · ${formatMoney(current.remedyPaise)}` : ''}
            </DescriptionItem>
            <DescriptionItem term="Note">{current.resolutionNote}</DescriptionItem>
          </>
        ) : null}
      </DescriptionList>
      {decidable && current.status === 'IN_REVIEW' ? (
        <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
          <Field label="Decision" htmlFor="quality-outcome">
            <Select value={outcome} onValueChange={(v) => setOutcome(QualityOutcome.parse(v))}>
              <SelectTrigger id="quality-outcome">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QualityOutcome.options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {OUTCOME_LABEL[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {money ? (
            <Field
              label="Amount (₹)"
              htmlFor="quality-amount"
              hint={
                outcome === 'PARTIAL_REFUND'
                  ? `At most what the client paid: ${formatMoney(current.amountPaidPaise)}. Above your limit, finance approves.`
                  : 'Credit is valid for 12 months. Above your limit, finance approves.'
              }
              error={touched ? fieldError(check, 'amountPaise') : null}
            >
              <Input
                id="quality-amount"
                inputMode="decimal"
                placeholder="2,500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          ) : null}
          <NoteField
            id="quality-note"
            label="Note for the record"
            required
            value={note}
            onChange={setNote}
            error={touched ? fieldError(check, 'note') : null}
          />
        </form>
      ) : null}
      {confirming && check.success ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirming}
          title={OUTCOME_LABEL[check.data.outcome]}
          consequence={decisionConsequence({
            outcome: check.data.outcome,
            amountPaise: check.data.amountPaise ?? 0,
            clientName: current.clientName,
            reference: current.reference,
          })}
          confirmLabel="Decide and close"
          pending={resolve.isPending}
          onConfirm={() => resolve.mutate(check.data)}
        />
      ) : null}
    </SideSheet>
  );
}
