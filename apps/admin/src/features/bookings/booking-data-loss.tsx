'use client';

import type {
  AdminBookingDetail,
  AdminBookingMoney,
  AdminConfirmDataLossBody,
  AdminConfirmPartialLossBody,
  AdminDataLossResponse,
  AdminPartialLossResponse,
  StaffGrant,
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
  Skeleton,
  Spinner,
} from '@clickco/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { describeError, isDefiniteRejection } from '../../shared/errors';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { bookingMoneyKey, MONEY_INVALIDATE } from './booking-money-keys';
import {
  completeLossRefundPaise,
  dataLossAccess,
  dataLossBody,
  dataLossConsequence,
  dataLossOpen,
  parsePercentBps,
  partialLossBody,
  partialLossConsequence,
  partialLossSplit,
  secondPersonRule,
} from './data-loss';
import { Empty, Section } from './section';

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId'>>;
type Kind = 'COMPLETE' | 'PARTIAL';
type Sent =
  | { readonly kind: 'COMPLETE'; readonly body: AdminConfirmDataLossBody }
  | { readonly kind: 'PARTIAL'; readonly body: AdminConfirmPartialLossBody };

const FORM_ID = 'booking-data-loss';

/**
 * "Files lost" on the booking page (ADR-0030 D2): while the files are uploading, processing or in
 * QA, the Quality Manager or the booking's city manager confirms a complete or a partial loss,
 * with a second person. Hidden from everyone else and at every other stage, as the API would
 * refuse them.
 */
export function BookingDataLoss({
  booking,
  grants,
}: {
  readonly booking: AdminBookingDetail;
  readonly grants: Grants;
}) {
  const [open, setOpen] = useState(false);
  if (!dataLossOpen(booking.status) || !dataLossAccess(grants, booking.cityId)) return null;
  return (
    <Section
      title="Files lost before delivery"
      description="If the photographer's files are gone for good, or part of them. The client gets back what was lost, by rule; the photographer is paid in full."
      action={
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Confirm data loss
        </Button>
      }
    >
      <Empty>
        Everything lost ends the booking. If part survived, choose "Part of the shoot": what
        survived is still delivered.
      </Empty>
      {open ? <DataLossSheet booking={booking} onClose={() => setOpen(false)} /> : null}
    </Section>
  );
}

function DataLossSheet({
  booking,
  onClose,
}: {
  readonly booking: AdminBookingDetail;
  readonly onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>('COMPLETE');
  const [percent, setPercent] = useState('');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [coCode, setCoCode] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** The request whose outcome is unknown: resent as is, never edited. */
  const [unsure, setUnsure] = useState<Sent | null>(null);
  const client = useQueryClient();
  const money = useQuery({
    queryKey: bookingMoneyKey(booking.id),
    queryFn: () => adminApi.money.bookingMoney(booking.id),
  });

  const input = { note, code, coEmail, coCode };
  const check = kind === 'COMPLETE' ? dataLossBody(input) : partialLossBody({ ...input, percent });
  const ready = check.success && money.data !== undefined;
  const consequence = money.data ? describe(booking, money.data, kind, percent) : '';
  const rule = money.data
    ? secondPersonRule(money.data, refundNow(money.data, kind, percent))
    : null;

  const confirm = useAdminMutation<Sent, AdminDataLossResponse | AdminPartialLossResponse>({
    run: (vars: Sent, idem) =>
      vars.kind === 'COMPLETE'
        ? adminApi.bookings.confirmDataLoss(booking.id, vars.body, idem)
        : adminApi.bookings.confirmPartialLoss(booking.id, vars.body, idem),
    success: (vars) =>
      vars.kind === 'COMPLETE'
        ? `${booking.reference} ended as data loss. The refund is on its way to the client.`
        : `Partial loss recorded on ${booking.reference}. The refund is on its way to the client.`,
    invalidate: MONEY_INVALIDATE,
    onSuccess: onClose,
  });
  const send = (sent: Sent) =>
    confirm.mutate(sent, {
      onError: (error) => {
        setConfirming(false);
        if (isDefiniteRejection(error)) {
          // Nothing happened: fresh codes make a new request (and a new key) on purpose.
          setUnsure(null);
          setCode('');
          setCoCode('');
          return;
        }
        setUnsure(sent);
        for (const queryKey of MONEY_INVALIDATE) void client.invalidateQueries({ queryKey });
      },
    });
  const locked = confirm.isPending || unsure !== null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (unsure) {
      send(unsure);
      return;
    }
    setTouched(true);
    if (ready) setConfirming(true);
  };
  const sendChecked = () => {
    if (!check.success) return;
    send(
      kind === 'COMPLETE'
        ? { kind, body: check.data as AdminConfirmDataLossBody }
        : { kind, body: check.data as AdminConfirmPartialLossBody },
    );
  };

  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || confirm.isPending ? undefined : onClose())}
      title="Confirm data loss"
      description={`${booking.reference} · ${booking.client.name}. Two people confirm: you and a second Quality Manager, finance person or super admin.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={confirm.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={confirm.isPending || !money.data}>
            {confirm.isPending && unsure ? <Spinner /> : null}
            {unsure ? 'Try again' : 'Confirm data loss'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        {unsure ? (
          <Alert variant="warning">
            <AlertTitle>We couldn't confirm whether it went through</AlertTitle>
            <AlertDescription>
              Try again: the same request is sent, so the loss is never recorded twice. If you close
              this, check the booking before confirming again.
            </AlertDescription>
          </Alert>
        ) : null}
        <Field label="What was lost" htmlFor="data-loss-kind">
          <Select
            value={kind}
            disabled={locked}
            onValueChange={(v) => setKind(v === 'PARTIAL' ? 'PARTIAL' : 'COMPLETE')}
          >
            <SelectTrigger id="data-loss-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="COMPLETE">All of it: the booking ends</SelectItem>
              <SelectItem value="PARTIAL">Part of the shoot: the rest is delivered</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        {kind === 'PARTIAL' ? (
          <Field
            label="Share of the shoot lost (%)"
            htmlFor="data-loss-percent"
            hint="More than 0 and less than 100. Everything lost is the other choice."
            error={
              touched && parsePercentBps(percent) === null
                ? 'Enter a share from 0.01 to 99.99'
                : null
            }
          >
            <Input
              id="data-loss-percent"
              inputMode="decimal"
              value={percent}
              disabled={locked}
              onChange={(e) => setPercent(e.target.value)}
            />
          </Field>
        ) : null}
        {money.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : money.isError ? (
          <Empty>{describeError(money.error).message}</Empty>
        ) : consequence ? (
          <Empty>{consequence}</Empty>
        ) : null}
        <NoteField
          id="data-loss-note"
          label="What was lost, and how you checked"
          required
          hint="Saved with the refund and in the audit log with both names."
          value={note}
          onChange={setNote}
          disabled={locked}
          error={touched ? fieldError(check, 'note') : null}
        />
        {rule ? (
          <Alert variant="info">
            <AlertTitle>Finance confirms this one with you</AlertTitle>
            <AlertDescription>{rule}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 rounded-md border p-4">
          <p className="text-sm">
            Money goes back by rule, so two people confirm: your authenticator code, and a second
            Quality Manager, finance person or super admin entering theirs here with you.
          </p>
          <AuthenticatorCodeField
            id="data-loss-code"
            label="Your authenticator code"
            hint="A fresh code, even though you are signed in."
            value={code}
            onChange={setCode}
            error={touched ? fieldError(check, 'code') : null}
            disabled={locked}
          />
          <Field
            label="Second approver's email"
            htmlFor="data-loss-co-email"
            error={touched ? fieldError(check, 'coApprover') : null}
          >
            <Input
              id="data-loss-co-email"
              type="email"
              autoComplete="off"
              value={coEmail}
              disabled={locked}
              onChange={(e) => setCoEmail(e.target.value)}
            />
          </Field>
          <AuthenticatorCodeField
            id="data-loss-co-code"
            label="Second approver's authenticator code"
            hint="From their own authenticator app."
            value={coCode}
            onChange={setCoCode}
            error={null}
            disabled={locked}
          />
        </div>
      </form>
      <AlertDialog
        open={confirming && ready}
        onOpenChange={(o) => (!confirm.isPending ? setConfirming(o) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kind === 'COMPLETE'
                ? `End ${booking.reference} as data loss?`
                : `Record a partial loss on ${booking.reference}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>{consequence} This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirm.isPending}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={confirm.isPending} onClick={sendChecked}>
              {confirm.isPending ? <Spinner /> : null}
              {kind === 'COMPLETE' ? 'End as data loss' : 'Record partial loss'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SideSheet>
  );
}

/** What goes back at once for the chosen kind (0 until a share is entered). */
function refundNow(money: AdminBookingMoney, kind: Kind, percent: string): number {
  if (kind === 'COMPLETE') return completeLossRefundPaise(money);
  const bps = parsePercentBps(percent);
  return bps === null ? 0 : partialLossSplit(money, bps).nowPaise;
}

/** The confirm text for the chosen kind, with the amounts (empty until a share is entered). */
function describe(
  booking: AdminBookingDetail,
  money: AdminBookingMoney,
  kind: Kind,
  percent: string,
): string {
  if (kind === 'COMPLETE') {
    return dataLossConsequence({
      reference: booking.reference,
      clientName: booking.client.name,
      photographerName: booking.assignment?.photographerName ?? null,
      refundPaise: completeLossRefundPaise(money),
    });
  }
  const bps = parsePercentBps(percent);
  if (bps === null) return '';
  return partialLossConsequence({
    reference: booking.reference,
    clientName: booking.client.name,
    bps,
    split: partialLossSplit(money, bps),
  });
}
