'use client';

import {
  AdminApproveClaimBody,
  AdminAssessClaimBody,
  type AdminClaimItem,
  AdminRejectClaimBody,
  CARE_ACTION_ROLES,
  isClaimPending,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  ExternalLinkIcon,
  Field,
  Input,
  SectionHeader,
  SideSheet,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink } from '../../shared/cells';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { formatDateTime, formatMoney } from '../../shared/format';
import { formatRupees, parseRupees, rupeesInput } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { safeHref } from '../../shared/safe-href';
import { useCan } from '../../shared/use-can';
import { approvable, CAUSE_LABEL, claimKeys, STATUS } from './labels';

type Decision = 'approve' | 'reject' | null;

/** One claim: the incident, its evidence trail, assessment, and the decision. */
export function ClaimSheet({
  claim,
  onClose,
}: {
  readonly claim: AdminClaimItem;
  readonly onClose: () => void;
}) {
  const [c, setC] = useState(claim);
  const canWork = useCan(CARE_ACTION_ROLES.workClaims)();
  const canDecide = useCan(CARE_ACTION_ROLES.decideClaims)();
  const pending = isClaimPending(c.status);
  const [decision, setDecision] = useState<Decision>(null);

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="lg"
      title={`Equipment claim on ${c.bookingReference}`}
      description={`${c.photographerName} · reported ${formatDateTime(c.reportedAt)}`}
      footer={
        pending && canDecide ? (
          <>
            <Button variant="outline" onClick={() => setDecision('reject')}>
              Reject
            </Button>
            <Button onClick={() => setDecision('approve')}>Approve…</Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-wrap gap-2">
        <Badge variant={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
      </div>
      <p className="rounded-md border bg-muted p-3 text-sm">{c.description}</p>
      <DescriptionList>
        <DescriptionItem term="Booking">
          <BookingLink id={c.bookingId} reference={c.bookingReference} />
        </DescriptionItem>
        <DescriptionItem term="Client">{c.clientName}</DescriptionItem>
        <DescriptionItem term="Caused by">{CAUSE_LABEL[c.cause]}</DescriptionItem>
        <DescriptionItem term="When it happened">{formatDateTime(c.incidentAt)}</DescriptionItem>
        <DescriptionItem term="Claimed">{formatMoney(c.claimedAmountPaise)}</DescriptionItem>
        <DescriptionItem term="Cap per incident">{formatMoney(c.capPaise)}</DescriptionItem>
        {c.approvedAmountPaise !== null ? (
          <DescriptionItem term="Approved">{formatMoney(c.approvedAmountPaise)}</DescriptionItem>
        ) : null}
        {c.resolutionNote ? (
          <DescriptionItem term={c.status === 'REJECTED' ? 'Why rejected' : 'Note'}>
            {c.resolutionNote}
            {c.reviewedByName ? ` — ${c.reviewedByName}` : ''}
          </DescriptionItem>
        ) : null}
      </DescriptionList>
      <SectionHeader
        title="Evidence and notes"
        description="Documentary evidence (a repair quote, an invoice, photos) is needed before approval."
      />
      {c.evidence.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing added yet.</p>
      ) : (
        <ul className="grid gap-2">
          {c.evidence.map((e) => (
            <li
              key={`${e.addedAt}-${e.kind}-${e.kind === 'LINK' ? e.url : e.text}`}
              className="rounded-md border p-3 text-sm"
            >
              {e.kind === 'LINK' && safeHref(e.url) ? (
                <a
                  href={safeHref(e.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold underline-offset-4 hover:underline"
                >
                  {e.label}
                  <ExternalLinkIcon className="size-4" />
                </a>
              ) : (
                <span>{e.kind === 'NOTE' ? e.text : `${e.label} (link removed: not https)`}</span>
              )}
              <span className="block text-muted-foreground text-xs">
                {e.addedByName ?? 'Staff'} · {formatDateTime(e.addedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {pending && canWork ? <AssessForm claim={c} onDone={setC} /> : null}
      {decision === 'approve' ? (
        <ApproveDialog claim={c} onClose={() => setDecision(null)} onDone={onClose} />
      ) : null}
      {decision === 'reject' ? (
        <RejectDialog claim={c} onClose={() => setDecision(null)} onDone={onClose} />
      ) : null}
    </SideSheet>
  );
}

function AssessForm({
  claim,
  onDone,
}: {
  readonly claim: AdminClaimItem;
  readonly onDone: (claim: AdminClaimItem) => void;
}) {
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminAssessClaimBody.safeParse({
    ...(note.trim() ? { note } : {}),
    links: url.trim() ? [{ url: url.trim(), label }] : [],
  });
  const assess = useAdminMutation({
    run: (vars: AdminAssessClaimBody, idem) => adminApi.care.claims.assess(claim.id, vars, idem),
    success: () => 'Added to the claim',
    invalidate: [claimKeys.all],
    onSuccess: (updated) => {
      setNote('');
      setUrl('');
      setLabel('');
      setTouched(false);
      onDone(updated);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) assess.mutate(check.data);
  };
  const linkError =
    touched && !check.success
      ? (check.error.issues.find((i) => i.path[0] === 'links')?.message ?? null)
      : null;
  return (
    <form className="grid gap-3 rounded-md border p-4" onSubmit={submit} noValidate>
      <p className="font-semibold text-sm">Add to the assessment</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Evidence link (https)" htmlFor="claim-url" error={linkError}>
          <Input
            id="claim-url"
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </Field>
        <Field label="What it is" htmlFor="claim-label">
          <Input
            id="claim-label"
            placeholder="Repair quote"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
      </div>
      <NoteField
        id="claim-note"
        label="Note"
        value={note}
        onChange={setNote}
        error={touched ? fieldError(check, 'note') : null}
      />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={assess.isPending}>
          {assess.isPending ? <Spinner /> : null}
          Add
        </Button>
      </div>
    </form>
  );
}

function ApproveDialog({
  claim,
  onClose,
  onDone,
}: {
  readonly claim: AdminClaimItem;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const max = approvable(claim.claimedAmountPaise, claim.capPaise);
  const [amount, setAmount] = useState(rupeesInput(max));
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const amountPaise = parseRupees(amount) ?? 0;
  const parsed = AdminApproveClaimBody.safeParse({ amountPaise, note });
  const overClaim = amountPaise > claim.claimedAmountPaise;
  const approve = useAdminMutation({
    run: (vars: AdminApproveClaimBody, idem) => adminApi.care.claims.approve(claim.id, vars, idem),
    success: () => `Claim approved — ${formatRupees(amountPaise)} sent to finance`,
    invalidate: [claimKeys.all],
    onSuccess: onDone,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Approve ${formatRupees(amountPaise)} for ${claim.photographerName}?`}
      consequence={`Finance gets a "To settle" item to pay ${claim.photographerName} ${formatRupees(amountPaise)} for the damaged gear, and to recover it from ${claim.clientName} under T&C §8.2. This decision cannot be undone.`}
      confirmLabel="Approve claim"
      pending={approve.isPending}
      onConfirm={() => {
        setTouched(true);
        if (parsed.success && !overClaim) approve.mutate(parsed.data);
      }}
    >
      <div className="grid gap-3">
        <Field
          label="Amount (₹)"
          htmlFor="claim-approve-amount"
          hint={`At most ${formatRupees(max)} (the amount claimed, within the ₹2,00,000 cap).`}
          error={
            touched
              ? overClaim
                ? 'You cannot approve more than was claimed'
                : fieldError(parsed, 'amountPaise')
              : null
          }
        >
          <Input
            id="claim-approve-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <NoteField
          id="claim-approve-note"
          label="Note for finance"
          required
          value={note}
          onChange={setNote}
          error={touched ? fieldError(parsed, 'note') : null}
        />
      </div>
    </ConfirmDialog>
  );
}

function RejectDialog({
  claim,
  onClose,
  onDone,
}: {
  readonly claim: AdminClaimItem;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = AdminRejectClaimBody.safeParse({ reason });
  const reject = useAdminMutation({
    run: (vars: AdminRejectClaimBody, idem) => adminApi.care.claims.reject(claim.id, vars, idem),
    success: () => 'Claim rejected',
    invalidate: [claimKeys.all],
    onSuccess: onDone,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Reject ${claim.photographerName}'s claim?`}
      consequence={`Nothing is paid for this damage. Tell ${claim.photographerName} why. This decision cannot be undone.`}
      confirmLabel="Reject claim"
      destructive
      pending={reject.isPending}
      onConfirm={() => {
        setTouched(true);
        if (parsed.success) reject.mutate(parsed.data);
      }}
    >
      <NoteField
        id="claim-reject-reason"
        label="Reason"
        required
        value={reason}
        onChange={setReason}
        error={touched ? fieldError(parsed, 'reason') : null}
      />
    </ConfirmDialog>
  );
}
