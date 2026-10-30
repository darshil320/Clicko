'use client';

import { type AdminRefundItem, AdminRejectRefundBody } from '@clickco/contracts';
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
  Badge,
  Button,
  DescriptionItem,
  DescriptionList,
  Separator,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { formatDateTime } from '../../shared/format';
import { formatRupees, REFUND_REASON_LABEL, REFUND_STATUS } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { formatAgo } from '../../shared/relative-time';
import { useNow } from '../../shared/use-now';

const REFUNDS_KEY = ['money', 'refunds'] as const;
const INVALIDATE = [REFUNDS_KEY, ['money', 'reviews'], keys.bookingAll] as const;

function When({ at, now }: { readonly at: string; readonly now: number }) {
  return (
    <span>
      {formatAgo(at, now)} <span className="text-muted-foreground">· {formatDateTime(at)}</span>
    </span>
  );
}

/** One refund in a side sheet: what, to whom, who asked; approve or reject (four-eyes). */
export function RefundSheet({
  refund,
  onClose,
}: {
  readonly refund: AdminRefundItem;
  readonly onClose: () => void;
}) {
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const rejectCheck = AdminRejectRefundBody.safeParse({ note });
  const amount = formatRupees(refund.amountPaise);

  const approve = useAdminMutation({
    run: (vars: { id: string }, idem) => adminApi.money.refunds.approve(vars.id, {}, idem),
    success: (_v, r) =>
      r.status === 'COMPLETED'
        ? `${amount} is on its way back to ${refund.clientName}`
        : r.status === 'FAILED'
          ? `The bank refused the refund — you can try again`
          : `Approved — waiting for the bank to confirm`,
    invalidate: INVALIDATE,
    onSuccess: () => setConfirming(false),
  });
  const reject = useAdminMutation({
    run: (vars: { id: string; note: string }, idem) =>
      adminApi.money.refunds.reject(vars.id, { note: vars.note }, idem),
    success: () => `Refund for ${refund.reference} rejected`,
    invalidate: INVALIDATE,
    onSuccess: onClose,
  });
  const retry = useAdminMutation({
    run: (vars: { id: string }, idem) => adminApi.money.refunds.retry(vars.id, idem),
    success: (_v, r) =>
      r.status === 'COMPLETED'
        ? `${amount} refunded to ${refund.clientName}`
        : 'Sent to the bank again',
    invalidate: INVALIDATE,
  });
  const busy = approve.isPending || reject.isPending || retry.isPending;

  const submitReject = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (rejectCheck.success) reject.mutate({ id: refund.id, note: rejectCheck.data.note });
  };

  const status = REFUND_STATUS[refund.status];
  const pending = refund.status === 'REQUESTED';
  const stuck = refund.status === 'FAILED' || refund.status === 'PROCESSING';

  return (
    <Sheet open onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <Badge variant={status.tone} className="w-fit">
            {status.label}
          </Badge>
          <SheetTitle className="text-2xl">{amount}</SheetTitle>
          <SheetDescription>
            Back to {refund.clientName} · {refund.paidWith} · booking {refund.reference}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          {pending && !refund.canDecide && refund.blockedReason ? (
            <Alert variant="info">
              <AlertTitle>You can't approve this one</AlertTitle>
              <AlertDescription>
                {refund.blockedReason} Every refund needs two people: one asks, another approves.
              </AlertDescription>
            </Alert>
          ) : null}
          {pending && refund.creditNoteLate ? (
            <Alert variant="warning">
              <AlertTitle>Past the GST credit-note window</AlertTitle>
              <AlertDescription>
                The invoice's financial year closed for credit notes on 30 November. The refund
                still goes back, but its GST can no longer be reduced — check with the CA.
              </AlertDescription>
            </Alert>
          ) : null}
          {refund.status === 'FAILED' && refund.failureReason ? (
            <Alert variant="destructive">
              <AlertTitle>The bank did not accept it</AlertTitle>
              <AlertDescription>{refund.failureReason}</AlertDescription>
            </Alert>
          ) : null}
          <DescriptionList className="sm:grid-cols-1">
            <DescriptionItem term="Why">{REFUND_REASON_LABEL[refund.reason]}</DescriptionItem>
            {refund.note ? <DescriptionItem term="Note">{refund.note}</DescriptionItem> : null}
            <DescriptionItem term="Asked by">
              {refund.requestedBy.name}, <When at={refund.requestedAt} now={now} />
            </DescriptionItem>
            {refund.decidedBy && refund.decidedAt ? (
              <DescriptionItem term={refund.status === 'REJECTED' ? 'Rejected by' : 'Approved by'}>
                {refund.decidedBy.name}, <When at={refund.decidedAt} now={now} />
                {refund.decisionNote ? (
                  <span className="block text-muted-foreground">“{refund.decisionNote}”</span>
                ) : null}
              </DescriptionItem>
            ) : null}
            {refund.completedAt ? (
              <DescriptionItem term="Refunded">
                <When at={refund.completedAt} now={now} />
              </DescriptionItem>
            ) : null}
            <DescriptionItem term="Booking total">
              {formatRupees(refund.bookingTotalPaise)}
            </DescriptionItem>
          </DescriptionList>
          {refund.creditNotes.length > 0 ? (
            <>
              <Separator />
              <div className="grid gap-2">
                <p className="font-semibold text-sm">GST credit notes</p>
                {refund.creditNotes.map((n) => (
                  <div key={n.id} className="grid gap-1 rounded-md border p-3 text-sm">
                    <span className="font-medium">
                      {n.number} · {formatRupees(n.totalPaise)}
                    </span>
                    <span className="text-muted-foreground">
                      Against invoice {n.invoiceNumber} · taxable {formatRupees(n.taxablePaise)}
                      {n.igstPaise > 0
                        ? ` · IGST ${formatRupees(n.igstPaise)}`
                        : ` · CGST ${formatRupees(n.cgstPaise)} · SGST ${formatRupees(n.sgstPaise)}`}
                    </span>
                    {n.lateForGst ? (
                      <Badge variant="warning">Issued after the GST window</Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {rejecting ? (
            <form id="reject-form" className="grid gap-3" onSubmit={submitReject} noValidate>
              <NoteField
                id="reject-note"
                label="Why are you rejecting it?"
                required
                hint="The person who asked sees this. Saved in the audit log."
                value={note}
                onChange={setNote}
                error={touched ? fieldError(rejectCheck, 'note') : null}
              />
            </form>
          ) : null}
        </div>
        <SheetFooter className="sm:flex-row sm:justify-end">
          {pending && rejecting ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(false)} disabled={busy}>
                Back
              </Button>
              <Button type="submit" form="reject-form" variant="destructive" disabled={busy}>
                {reject.isPending ? <Spinner /> : null}
                Reject refund
              </Button>
            </>
          ) : pending ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(true)} disabled={busy}>
                Reject
              </Button>
              <Button onClick={() => setConfirming(true)} disabled={busy || !refund.canDecide}>
                Approve refund
              </Button>
            </>
          ) : stuck && refund.canDecide ? (
            <Button onClick={() => retry.mutate({ id: refund.id })} disabled={busy}>
              {retry.isPending ? <Spinner /> : null}
              {refund.status === 'FAILED' ? 'Try again' : 'Check with the bank again'}
            </Button>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </SheetFooter>
        <AlertDialog
          open={confirming}
          onOpenChange={(o) => (!approve.isPending ? setConfirming(o) : undefined)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {amount} goes back to {refund.clientName}
              </AlertDialogTitle>
              <AlertDialogDescription>
                It is refunded to {refund.paidWith} now and usually reaches them in 5–7 working
                days. A GST credit note is issued against the invoice. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={approve.isPending}>Cancel</AlertDialogCancel>
              <Button
                onClick={() => approve.mutate({ id: refund.id })}
                disabled={approve.isPending}
              >
                {approve.isPending ? <Spinner /> : null}
                Refund {amount}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
