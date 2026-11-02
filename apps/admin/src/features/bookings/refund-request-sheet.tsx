'use client';

import {
  type AdminBookingMoney,
  type AdminRequestRefundBody,
  RefundReason,
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
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatRupees, parseRupees, REFUND_REASON_LABEL } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { MONEY_INVALIDATE } from './booking-money-keys';
import {
  refundAmountProblem,
  refundablePayments,
  refundBody,
  refundConsequence,
  refundNeedsFinance,
  refundRoom,
} from './money-actions';

const FORM_ID = 'booking-refund-request';
/** The Select's value for "spread over the payments, newest first". */
const AUTO = 'AUTO';

/**
 * Ask for a refund from the booking page (ADR-0026 D1): maker–checker, so someone else approves
 * it on the Refunds desk — above the Quality Manager's ceiling, finance with a fresh code.
 */
export function RefundRequestSheet({
  money,
  onClose,
}: {
  readonly money: AdminBookingMoney;
  readonly onClose: () => void;
}) {
  const payments = refundablePayments(money);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState<RefundReason>('GOODWILL');
  const [paymentId, setPaymentId] = useState<string>(AUTO);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const chosen = paymentId === AUTO ? null : paymentId;
  const payment = chosen ? (payments.find((p) => p.id === chosen) ?? null) : null;
  const amountPaise = parseRupees(amount);
  const amountProblem = refundAmountProblem(money, amountPaise, chosen ?? undefined);
  const check = refundBody({ amount, reason, note, paymentId: chosen });
  const ready = check.success && amountProblem === null;
  const toFinance =
    amountPaise !== null && amountPaise > 0 && refundNeedsFinance(money, amountPaise);

  const request = useAdminMutation({
    run: (vars: { body: AdminRequestRefundBody }, idem) =>
      adminApi.money.refunds.request(money.bookingId, vars.body, idem),
    success: (vars) =>
      `Refund of ${formatRupees(vars.body.amountPaise)} asked for — waiting for approval on the Refunds desk`,
    invalidate: MONEY_INVALIDATE,
    onSuccess: onClose,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (ready) setConfirming(true);
  };

  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || request.isPending ? undefined : onClose())}
      title="Ask for a refund"
      description={`${money.reference} · ${money.clientName}. Someone else approves it on the Refunds desk.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={request.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={request.isPending}>
            Ask for refund
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="Amount (₹)"
          htmlFor="refund-amount"
          hint={`Up to ${formatRupees(refundRoom(money, chosen ?? undefined))} can go back now.`}
          error={touched ? amountProblem : null}
        >
          <Input
            id="refund-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {payments.length > 1 ? (
          <Field label="Back to" htmlFor="refund-payment">
            <Select value={paymentId} onValueChange={setPaymentId}>
              <SelectTrigger id="refund-payment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Newest payment first</SelectItem>
                {payments.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.paidWith} · up to {formatRupees(p.refundablePaise)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <Field label="Why" htmlFor="refund-reason">
          <Select value={reason} onValueChange={(v) => setReason(RefundReason.parse(v))}>
            <SelectTrigger id="refund-reason">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RefundReason.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {REFUND_REASON_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <NoteField
          id="refund-note"
          label="Note"
          required
          hint="The approver sees this. Saved in the audit log with your name."
          value={note}
          onChange={setNote}
          error={touched ? fieldError(check, 'note') : null}
        />
        {toFinance ? (
          <Alert variant="info">
            <AlertTitle>Finance approves this one</AlertTitle>
            <AlertDescription>
              With the refunds and credits already on this booking it goes above the Quality
              Manager's limit of {formatRupees(money.qmLimitPaise)}, so finance approves it with a
              fresh code from their authenticator app.
            </AlertDescription>
          </Alert>
        ) : null}
      </form>
      <AlertDialog
        open={confirming && ready}
        onOpenChange={(o) => (!request.isPending ? setConfirming(o) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Ask for a {formatRupees(amountPaise ?? 0)} refund for {money.clientName}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {refundConsequence(money, amountPaise ?? 0, payment)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={request.isPending}>Cancel</AlertDialogCancel>
            <Button
              disabled={request.isPending}
              onClick={() => {
                if (check.success) request.mutate({ body: check.data });
              }}
            >
              {request.isPending ? <Spinner /> : null}
              Ask for refund
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SideSheet>
  );
}
