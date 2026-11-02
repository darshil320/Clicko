'use client';

import {
  type AdminBookingMoney,
  type AdminIssueCreditBody,
  CREDIT_FOUR_EYES_PAISE,
  CreditReason,
} from '@clickco/contracts';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Button,
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
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { isDefiniteRejection } from '../../shared/errors';
import { CREDIT_REASON_LABEL, formatRupees, parseRupees } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { MONEY_INVALIDATE } from './booking-money-keys';
import {
  creditAmountProblem,
  creditBody,
  creditConsequence,
  creditNeedsFourEyes,
  creditRoom,
} from './money-actions';

const FORM_ID = 'booking-issue-credit';

/**
 * Issue a client credit from the booking page (ADR-0026 D2): the Quality Manager within the
 * ceiling, finance any amount; above ₹5,000 four-eyes in one request (audit L8). Refunds and
 * credits together never come to more than the booking total.
 *
 * Security review H1: a credit can't be withdrawn, so a failure whose outcome is unknown (offline,
 * timeout, 5xx, the same request still running) never leads to a second one. The exact request
 * that was sent is kept with its Idempotency-Key, the form locks, and "Try again" resends it
 * unchanged: the server replays its stored answer instead of issuing again. Only a definite
 * refusal (a wrong code, no access, a validation error) clears the codes for a fresh attempt.
 */
export function IssueCreditSheet({
  money,
  unlimited,
  onClose,
}: {
  readonly money: AdminBookingMoney;
  /** Finance or super admin in the booking's city: no Quality Manager ceiling. */
  readonly unlimited: boolean;
  readonly onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<CreditReason>('GOODWILL');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [coCode, setCoCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** The request whose outcome is unknown: resent as is, never edited. */
  const [unsure, setUnsure] = useState<AdminIssueCreditBody | null>(null);
  const client = useQueryClient();

  const amountPaise = parseRupees(amount);
  const fourEyes = amountPaise !== null && creditNeedsFourEyes(amountPaise);
  const amountProblem = creditAmountProblem(money, unlimited, amountPaise);
  const check = creditBody({ amount, reason, note, approval: { code, coEmail, coCode } });
  const ready = check.success && amountProblem === null;
  const room = creditRoom(money, unlimited);

  const issue = useAdminMutation({
    run: (vars: { body: AdminIssueCreditBody }, idem) =>
      adminApi.money.credits.issue(money.bookingId, vars.body, idem),
    success: (_vars, credit) =>
      `${money.clientName} has a ${formatRupees(credit.amountPaise)} credit, valid for 12 months`,
    invalidate: MONEY_INVALIDATE,
    onSuccess: onClose,
  });
  const send = (body: AdminIssueCreditBody) =>
    issue.mutate(
      { body },
      {
        onError: (error) => {
          setConfirming(false);
          if (isDefiniteRejection(error)) {
            // Nothing was issued: fresh codes make a new request (and a new key) on purpose.
            setUnsure(null);
            setCode('');
            setCoCode('');
            return;
          }
          setUnsure(body);
          // Show what really happened as soon as the server can say.
          for (const queryKey of MONEY_INVALIDATE) void client.invalidateQueries({ queryKey });
        },
      },
    );
  const locked = issue.isPending || unsure !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unsure) {
      send(unsure);
      return;
    }
    setTouched(true);
    if (ready) setConfirming(true);
  };

  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || issue.isPending ? undefined : onClose())}
      title="Issue a credit"
      description={`${money.reference} · ${money.clientName}. Used on a future booking, valid 12 months.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={issue.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={issue.isPending}>
            {issue.isPending && unsure ? <Spinner /> : null}
            {unsure ? 'Try again' : 'Issue credit'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        {unsure ? (
          <Alert variant="warning">
            <AlertTitle>We couldn't confirm whether it went through</AlertTitle>
            <AlertDescription>
              Try again: the same request is sent, so the credit is never issued twice. If you close
              this, check the booking's credits before issuing another.
            </AlertDescription>
          </Alert>
        ) : null}
        <Field
          label="Amount (₹)"
          htmlFor="credit-amount"
          hint={
            room.limitedBy === 'TOTAL'
              ? `Up to ${formatRupees(room.maxPaise)}: refunds and credits never come to more than the booking total.`
              : `Up to ${formatRupees(room.maxPaise)}: your limit on this booking. Finance can issue more.`
          }
          error={touched ? amountProblem : null}
        >
          <Input
            id="credit-amount"
            inputMode="decimal"
            value={amount}
            disabled={locked}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <Field label="Why" htmlFor="credit-reason">
          <Select
            value={reason}
            disabled={locked}
            onValueChange={(v) => setReason(CreditReason.parse(v))}
          >
            <SelectTrigger id="credit-reason">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CreditReason.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {CREDIT_REASON_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NoteField
          id="credit-note"
          label="Note"
          required
          hint="Saved in the audit log with your name."
          value={note}
          onChange={setNote}
          disabled={locked}
          error={touched ? fieldError(check, 'note') : null}
        />
        {fourEyes ? (
          <div className="grid gap-4 rounded-md border p-4">
            <p className="text-sm">
              Credits above {formatRupees(CREDIT_FOUR_EYES_PAISE)} need two people: your
              authenticator code, and a second finance person (or super admin) entering theirs here
              with you.
            </p>
            <AuthenticatorCodeField
              id="credit-code"
              label="Your authenticator code"
              hint="A fresh code, even though you are signed in."
              value={code}
              onChange={setCode}
              error={touched ? fieldError(check, 'code') : null}
              disabled={locked}
            />
            <Field
              label="Second approver's email"
              htmlFor="credit-co-email"
              error={touched ? fieldError(check, 'coApprover') : null}
            >
              <Input
                id="credit-co-email"
                type="email"
                autoComplete="off"
                value={coEmail}
                disabled={locked}
                onChange={(e) => setCoEmail(e.target.value)}
              />
            </Field>
            <AuthenticatorCodeField
              id="credit-co-code"
              label="Second approver's authenticator code"
              hint="From their own authenticator app."
              value={coCode}
              onChange={setCoCode}
              error={null}
              disabled={locked}
            />
          </div>
        ) : null}
      </form>
      <AlertDialog
        open={confirming && ready}
        onOpenChange={(o) => (!issue.isPending ? setConfirming(o) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Give {money.clientName} a {formatRupees(amountPaise ?? 0)} credit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {creditConsequence(money, amountPaise ?? 0)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={issue.isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={issue.isPending}
              onClick={() => {
                if (check.success) send(check.data);
              }}
            >
              {issue.isPending ? <Spinner /> : null}
              Issue {formatRupees(amountPaise ?? 0)} credit
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SideSheet>
  );
}
