'use client';

import {
  AdminMarkPayoutFailedBody,
  type AdminPayoutTransfer,
  AdminRetryPayoutBody,
  PAYOUT_EARLY_RESEND_DAYS,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  Field,
  Input,
  SideSheet,
  Spinner,
  toast,
} from '@clickco/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { BookingLink, Muted } from '../../shared/cells';
import { describeError } from '../../shared/errors';
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { useSession } from '../../shared/session';
import { maskedAccount, percent, rupeesExact, TRANSFER_STATE } from './labels';
import { Confirm, payoutKeys, saveFile } from './shared';

const DAY_MS = 86_400_000;

/**
 * One photographer's transfer: the breakdown, the statement, and failed / send again. Audit H2:
 * failed / send again need the bank's return reference and a fresh authenticator code, and are
 * done by someone other than whoever made the bank file (maker–checker) — the sheet says so.
 */
export function TransferSheet({
  batchId,
  transfer: t,
  onClose,
}: {
  readonly batchId: string;
  readonly transfer: AdminPayoutTransfer;
  readonly onClose: () => void;
}) {
  const [failing, setFailing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [reason, setReason] = useState('');
  const [bankReference, setBankReference] = useState('');
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminMarkPayoutFailedBody.safeParse({
    photographerId: t.photographerId,
    reason,
    bankReference,
    code,
  });
  const retryCheck = AdminRetryPayoutBody.safeParse({ photographerId: t.photographerId, code });
  const meId = useSession()?.staff.id ?? null;
  const isMaker = meId !== null && t.sentBy?.id === meId;
  const makerNote = isMaker
    ? 'You made the bank file this transfer went out in, so another finance person has to mark it failed or send it again.'
    : null;
  const recentFile =
    t.sentAt !== null && Date.now() - Date.parse(t.sentAt) < PAYOUT_EARLY_RESEND_DAYS * DAY_MS;
  const closeDialogs = () => {
    setFailing(false);
    setRetrying(false);
    setCode('');
    setTouched(false);
  };

  const fail = useAdminMutation({
    run: (body: AdminMarkPayoutFailedBody, idem) =>
      adminApi.payouts.batches.markFailed(batchId, body, idem),
    success: () => `${t.name}'s transfer is marked failed`,
    invalidate: [payoutKeys.all],
    onSuccess: onClose,
  });
  const retry = useAdminMutation({
    run: (body: AdminRetryPayoutBody, idem) => adminApi.payouts.batches.retry(batchId, body, idem),
    success: () => `${t.name} is back in the bank file`,
    invalidate: [payoutKeys.all],
    onSuccess: onClose,
  });
  const statement = useMutation({
    gcTime: 0,
    mutationFn: () => adminApi.payouts.batches.statement(batchId, t.photographerId),
    onSuccess: saveFile,
    onError: (error) => toast.error(describeError(error).message),
  });
  const state = TRANSFER_STATE[t.state];
  const exported = t.state !== 'IN_DRAFT';

  return (
    <>
      <SideSheet
        open
        size="lg"
        onOpenChange={(o) => (o ? undefined : onClose())}
        title={t.name}
        description={`${rupeesExact(t.netPaise)} to the bank${t.reference ? ` · ${t.reference}` : ''}`}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            {t.state === 'AWAITING_PAYMENT' ? (
              <Button variant="outline" disabled={isMaker} onClick={() => setFailing(true)}>
                The bank returned it
              </Button>
            ) : null}
            {t.state === 'FAILED' ? (
              <Button disabled={isMaker} onClick={() => setRetrying(true)}>
                Send again
              </Button>
            ) : null}
            {exported ? (
              <Button
                variant="outline"
                disabled={statement.isPending}
                onClick={() => statement.mutate(undefined, { onSettled: () => statement.reset() })}
              >
                {statement.isPending ? <Spinner /> : null}
                Download statement
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-6">
          <DescriptionList>
            <DescriptionItem term="Status">
              <Badge variant={state.tone}>{state.label}</Badge>
              {t.failureReason ? <Muted> {t.failureReason}</Muted> : null}
              {t.failureReference ? <Muted> · bank reference {t.failureReference}</Muted> : null}
            </DescriptionItem>
            {t.sentBy ? (
              <DescriptionItem term="Bank file made by">
                {t.sentBy.name}
                {t.sentAt ? <Muted> · {formatDateTime(t.sentAt)}</Muted> : null}
              </DescriptionItem>
            ) : null}
            {makerNote && (t.state === 'AWAITING_PAYMENT' || t.state === 'FAILED') ? (
              <DescriptionItem term="Who can act">{makerNote}</DescriptionItem>
            ) : null}
            <DescriptionItem term="Bank">
              {t.bank ? `${t.bank.holder} · ${maskedAccount(t.bank)} · ${t.bank.ifsc}` : '—'}
            </DescriptionItem>
            <DescriptionItem term="PAN">
              {t.pan.masked ?? 'Not on file'}
              {t.pan.valid ? null : <Badge variant="warning">20% TDS</Badge>}
            </DescriptionItem>
            <DescriptionItem term="Bank reference (UTR)">
              {t.utr ? `${t.utr}${t.paidAt ? ` · ${formatDateTime(t.paidAt)}` : ''}` : '—'}
            </DescriptionItem>
          </DescriptionList>

          <DescriptionList className="sm:grid-cols-3">
            <DescriptionItem term="Earned">{rupeesExact(t.grossPaise)}</DescriptionItem>
            <DescriptionItem term="Deductions">− {rupeesExact(t.deductionsPaise)}</DescriptionItem>
            <DescriptionItem term="TDS">− {rupeesExact(t.tdsPaise)}</DescriptionItem>
            <DescriptionItem term="Owed from before">
              {rupeesExact(t.broughtForwardPaise)}
            </DescriptionItem>
            <DescriptionItem term="Carried to next payout">
              {rupeesExact(t.carriedForwardPaise)}
            </DescriptionItem>
            <DescriptionItem term="To the bank">
              <span className="font-semibold">{rupeesExact(t.netPaise)}</span>
            </DescriptionItem>
          </DescriptionList>

          <ul className="grid gap-3">
            {t.lines.map((l) => (
              <li key={l.payoutId} className="flex items-start justify-between gap-4 border-b pb-3">
                <div className="grid">
                  <BookingLink id={l.bookingId} reference={l.bookingReference} />
                  <Muted>
                    {l.tdsPaise > 0
                      ? `TDS ${percent(l.tdsRateBps)} (s.${l.tdsSection}) ${rupeesExact(l.tdsPaise)}`
                      : 'No TDS'}
                    {l.penaltyDeductionPaise + l.otherDeductionPaise > 0
                      ? ` · deductions ${rupeesExact(l.penaltyDeductionPaise + l.otherDeductionPaise)}`
                      : ''}
                  </Muted>
                </div>
                <div className="grid text-right">
                  <span className="font-semibold">{rupeesExact(l.netPaise)}</span>
                  <Muted>of {rupeesExact(l.grossPaise)}</Muted>
                </div>
              </li>
            ))}
          </ul>

          {t.deductions.length > 0 ? (
            <ul className="grid gap-2">
              {t.deductions.map((d) => (
                <li key={`${d.kind}-${d.bookingReference}-${d.amountPaise}`} className="text-sm">
                  {d.kind === 'LATE_DELIVERY' ? 'Late delivery' : 'Penalty'} on {d.bookingReference}
                  : {percent(d.rateBps)} of {rupeesExact(d.basisPaise)} ={' '}
                  <span className="font-semibold">{rupeesExact(d.amountPaise)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </SideSheet>

      {failing ? (
        <Confirm
          destructive
          title={`Mark ${t.name}'s transfer as failed?`}
          description={
            <span className="grid gap-3">
              <span>
                {rupeesExact(t.netPaise)} did not reach {t.name}. It waits here until someone sends
                it again; nothing is lost. Only mark it failed when the bank has confirmed the
                return — if the money did land, sending it again pays twice.
              </span>
              <Field
                label="Bank's return or rejection reference"
                htmlFor="fail-bank-reference"
                hint="From the bank's return file or statement, so it can be quoted back to the bank."
                error={touched ? fieldError(check, 'bankReference') : null}
              >
                <Input
                  id="fail-bank-reference"
                  autoComplete="off"
                  maxLength={40}
                  value={bankReference}
                  onChange={(e) => setBankReference(e.target.value)}
                />
              </Field>
              <NoteField
                id="fail-reason"
                label="What the bank said"
                required
                value={reason}
                onChange={setReason}
                error={touched ? fieldError(check, 'reason') : null}
              />
              <AuthenticatorCodeField
                id="fail-code"
                hint="Marking a transfer failed needs a fresh code, even though you are signed in."
                value={code}
                onChange={setCode}
                error={touched ? fieldError(check, 'code') : null}
              />
            </span>
          }
          confirmLabel="Mark failed"
          pending={fail.isPending}
          onConfirm={() => {
            setTouched(true);
            if (check.success) fail.mutate(check.data, { onError: () => setCode('') });
          }}
          onClose={closeDialogs}
        />
      ) : null}
      {retrying ? (
        <Confirm
          title={`Send ${rupeesExact(t.netPaise)} to ${t.name} again?`}
          description={
            <span className="grid gap-3">
              <span>
                It goes into this batch's next bank file, to the bank account now on file. Download
                the bank file again after this.
              </span>
              {recentFile ? (
                <span>
                  The first file went out less than {PAYOUT_EARLY_RESEND_DAYS} days ago, so the
                  operations team is alerted to check the money did not land after all.
                </span>
              ) : null}
              <AuthenticatorCodeField
                id="retry-code"
                hint="Sending money again needs a fresh code, even though you are signed in."
                value={code}
                onChange={setCode}
                error={touched ? fieldError(retryCheck, 'code') : null}
              />
            </span>
          }
          confirmLabel="Send again"
          pending={retry.isPending}
          onConfirm={() => {
            setTouched(true);
            if (retryCheck.success) retry.mutate(retryCheck.data, { onError: () => setCode('') });
          }}
          onClose={closeDialogs}
        />
      ) : null}
    </>
  );
}
