'use client';

import {
  type AdminReviewItem,
  AdminSettleReviewBody,
  CREDIT_FOUR_EYES_PAISE,
  CreditReason,
  MONEY_APPROVER_ROLES,
  RefundReason,
  ReviewOutcome,
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
  DescriptionItem,
  DescriptionList,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Spinner,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { isSuperAdmin } from '../../shared/access';
import { adminApi } from '../../shared/api';
import { AuthenticatorCodeField } from '../../shared/authenticator-code-field';
import { formatBps, formatDateTime, formatMinutes } from '../../shared/format';
import {
  CREDIT_REASON_LABEL,
  formatRupees,
  OUTCOME_LABEL,
  parseRupees,
  REFUND_REASON_LABEL,
  rupeesInput,
} from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { formatAgo } from '../../shared/relative-time';
import { useNow } from '../../shared/use-now';
import { outcomeText } from './reviews-desk';
import { consequence } from './settle-copy';

const INVALIDATE = [['money', 'reviews'], ['money', 'refunds'], keys.bookingAll] as const;

/** The credit this outcome issues (audit L8: above ₹5,000 it is four-eyes). */
function creditOf(outcome: ReviewOutcome, amount: string, credit: string): number {
  if (outcome === 'CREDIT_ISSUED') return parseRupees(amount) ?? 0;
  if (outcome === 'REFUND_REQUESTED') return parseRupees(credit) ?? 0;
  return 0;
}

function bodyOf(f: {
  outcome: ReviewOutcome;
  amount: string;
  credit: string;
  refundReason: RefundReason;
  creditReason: CreditReason;
  note: string;
  approval: { code: string; coEmail: string; coCode: string } | null;
}) {
  const amountPaise = parseRupees(f.amount) ?? -1;
  const creditPaise = parseRupees(f.credit) ?? 0;
  const approval = f.approval
    ? { code: f.approval.code, coApprover: { email: f.approval.coEmail, code: f.approval.coCode } }
    : {};
  if (f.outcome === 'REFUND_REQUESTED') {
    return AdminSettleReviewBody.safeParse({
      outcome: f.outcome,
      amountPaise,
      refundReason: f.refundReason,
      ...(creditPaise > 0 ? { creditPaise } : {}),
      note: f.note,
      ...approval,
    });
  }
  if (f.outcome === 'CREDIT_ISSUED') {
    return AdminSettleReviewBody.safeParse({
      outcome: f.outcome,
      amountPaise,
      creditReason: f.creditReason,
      note: f.note,
      ...approval,
    });
  }
  if (f.outcome === 'CHARGE_RAISED') {
    return AdminSettleReviewBody.safeParse({ outcome: f.outcome, amountPaise, note: f.note });
  }
  return AdminSettleReviewBody.safeParse({ outcome: f.outcome, note: f.note });
}

/** One review item in a side sheet: what happened, the suggestion, and settling it once. */
export function SettleSheet({
  item,
  onClose,
}: {
  readonly item: AdminReviewItem;
  readonly onClose: () => void;
}) {
  const now = useNow();
  const me = useQuery({ queryKey: keys.me, queryFn: () => adminApi.me() });
  const grants = me.data?.grants ?? [];
  const canSettle =
    isSuperAdmin(grants) ||
    grants.some((g) => (MONEY_APPROVER_ROLES as readonly string[]).includes(g.role));
  const s = item.suggestion;
  const fixed = item.breach !== null;
  const [outcome, setOutcome] = useState<ReviewOutcome>(s.outcome);
  const [amount, setAmount] = useState(s.amountPaise > 0 ? rupeesInput(s.amountPaise) : '');
  const [credit, setCredit] = useState(s.creditPaise > 0 ? rupeesInput(s.creditPaise) : '');
  const [refundReason, setRefundReason] = useState<RefundReason>(s.refundReason ?? 'GOODWILL');
  const [creditReason, setCreditReason] = useState<CreditReason>(s.creditReason ?? 'GOODWILL');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState('');
  const [coEmail, setCoEmail] = useState('');
  const [coCode, setCoCode] = useState('');
  const fourEyes = creditOf(outcome, amount, credit) > CREDIT_FOUR_EYES_PAISE;
  const check = bodyOf({
    outcome,
    amount,
    credit,
    refundReason,
    creditReason,
    note,
    approval: fourEyes ? { code, coEmail, coCode } : null,
  });

  const settle = useAdminMutation({
    run: (vars: { eventId: string; body: AdminSettleReviewBody }, idem) =>
      adminApi.money.reviews.settle(vars.eventId, vars.body, idem),
    success: (vars) =>
      vars.body.outcome === 'REFUND_REQUESTED'
        ? 'Settled — the refund is waiting for approval on the Refunds desk'
        : `Settled: ${OUTCOME_LABEL[vars.body.outcome].toLowerCase()}`,
    invalidate: INVALIDATE,
    onSuccess: onClose,
  });
  const clearCodes = () => {
    setCode('');
    setCoCode('');
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) setConfirming(true);
  };
  const money = outcome !== 'NO_ACTION';
  const amountError =
    touched && money && (parseRupees(amount) ?? 0) <= 0 ? 'Enter an amount above ₹0' : null;
  const res = item.resolution;

  return (
    <Sheet open onOpenChange={(open) => (!open && !settle.isPending ? onClose() : undefined)}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{item.title}</SheetTitle>
          <SheetDescription>
            {item.reference
              ? `${item.reference} · ${item.clientName} · ${item.cityName}`
              : 'Not about a booking'}
            {' · '}
            {formatAgo(item.raisedAt, now)} ({formatDateTime(item.raisedAt)})
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 px-4">
          <DescriptionList>
            <DescriptionItem term="Booking total">
              {formatRupees(item.bookingTotalPaise)}
            </DescriptionItem>
            <DescriptionItem term="Paid (net)">{formatRupees(item.paidPaise)}</DescriptionItem>
            <DescriptionItem term="Can still refund">
              {formatRupees(item.refundablePaise)}
            </DescriptionItem>
            {item.breach ? (
              <DescriptionItem term="Late by">
                {formatMinutes(item.breach.delayMinutes)} ·{' '}
                {formatBps(item.breach.payoutDeductionBps)} off the photographer's payout
                {item.breach.attributedTo === 'PHOTOGRAPHER'
                  ? ''
                  : ' (not theirs: nothing deducted)'}
              </DescriptionItem>
            ) : null}
          </DescriptionList>
          {res ? (
            <Alert variant="success">
              <AlertTitle>Settled: {outcomeText(res)}</AlertTitle>
              <AlertDescription>
                {res.resolvedBy.name}, {formatAgo(res.resolvedAt, now)} — “{res.note}”
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="info">
              <AlertTitle>Suggested: {outcomeText(s)}</AlertTitle>
              <AlertDescription>{s.why}</AlertDescription>
            </Alert>
          )}
          {!res && !canSettle ? (
            <p className="text-muted-foreground text-sm">
              The Quality Manager or finance settles these items.
            </p>
          ) : null}
          {!res && canSettle ? (
            <form id="settle-form" className="grid gap-4" onSubmit={submit} noValidate>
              {fixed ? (
                <p className="text-muted-foreground text-sm">
                  Late deliveries are settled exactly as the remedy table prices them. To change
                  that, waive the breach on the Breaches desk first.
                </p>
              ) : null}
              <Field label="Outcome" htmlFor="settle-outcome">
                <Select
                  value={outcome}
                  onValueChange={(v) => setOutcome(ReviewOutcome.parse(v))}
                  disabled={fixed}
                >
                  <SelectTrigger id="settle-outcome">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ReviewOutcome.options.map((o) => (
                      <SelectItem key={o} value={o}>
                        {OUTCOME_LABEL[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {money ? (
                <Field label="Amount (₹)" htmlFor="settle-amount" error={amountError}>
                  <Input
                    id="settle-amount"
                    inputMode="decimal"
                    value={amount}
                    disabled={fixed}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </Field>
              ) : null}
              {outcome === 'REFUND_REQUESTED' ? (
                <>
                  <Field label="Why" htmlFor="settle-refund-reason">
                    <Select
                      value={refundReason}
                      onValueChange={(v) => setRefundReason(RefundReason.parse(v))}
                    >
                      <SelectTrigger id="settle-refund-reason">
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
                  <Field
                    label="Also give a credit (₹, optional)"
                    htmlFor="settle-credit"
                    hint="Issued now, valid 12 months — e.g. the ₹500 no-show apology."
                  >
                    <Input
                      id="settle-credit"
                      inputMode="decimal"
                      value={credit}
                      onChange={(e) => setCredit(e.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              {outcome === 'CREDIT_ISSUED' ? (
                <Field label="Why" htmlFor="settle-credit-reason">
                  <Select
                    value={creditReason}
                    onValueChange={(v) => setCreditReason(CreditReason.parse(v))}
                    disabled={fixed}
                  >
                    <SelectTrigger id="settle-credit-reason">
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
              ) : null}
              <NoteField
                id="settle-note"
                label="Note"
                required
                hint="Saved in the audit log with your name."
                value={note}
                onChange={setNote}
                error={touched ? fieldError(check, 'note') : null}
              />
              {fourEyes ? (
                <div className="grid gap-4 rounded-md border p-4">
                  <p className="text-sm">
                    Credits above {formatRupees(CREDIT_FOUR_EYES_PAISE)} need two people: your
                    authenticator code, and a second finance person (or super admin) entering theirs
                    here with you.
                  </p>
                  <AuthenticatorCodeField
                    id="settle-code"
                    label="Your authenticator code"
                    hint="A fresh code, even though you are signed in."
                    value={code}
                    onChange={setCode}
                    error={touched ? fieldError(check, 'code') : null}
                  />
                  <Field
                    label="Second approver's email"
                    htmlFor="settle-co-email"
                    error={touched ? fieldError(check, 'coApprover') : null}
                  >
                    <Input
                      id="settle-co-email"
                      type="email"
                      autoComplete="off"
                      value={coEmail}
                      onChange={(e) => setCoEmail(e.target.value)}
                    />
                  </Field>
                  <AuthenticatorCodeField
                    id="settle-co-code"
                    label="Second approver's authenticator code"
                    hint="From their own authenticator app."
                    value={coCode}
                    onChange={setCoCode}
                    error={null}
                  />
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
        <SheetFooter className="sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={settle.isPending}>
            {res || !canSettle ? 'Close' : 'Cancel'}
          </Button>
          {!res && canSettle ? (
            <Button type="submit" form="settle-form" disabled={settle.isPending}>
              Settle
            </Button>
          ) : null}
        </SheetFooter>
        <AlertDialog
          open={confirming && check.success}
          onOpenChange={(o) => (!settle.isPending ? setConfirming(o) : undefined)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Settle as “{OUTCOME_LABEL[outcome].toLowerCase()}”?
              </AlertDialogTitle>
              <AlertDialogDescription>
                {consequence(
                  item,
                  outcome,
                  parseRupees(amount) ?? 0,
                  outcome === 'REFUND_REQUESTED' ? (parseRupees(credit) ?? 0) : 0,
                )}{' '}
                An item is settled only once.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={settle.isPending}>Cancel</AlertDialogCancel>
              <Button
                disabled={settle.isPending}
                onClick={() => {
                  if (check.success) {
                    settle.mutate(
                      { eventId: item.eventId, body: check.data },
                      { onError: clearCodes },
                    );
                  }
                }}
              >
                {settle.isPending ? <Spinner /> : null}
                Settle
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
