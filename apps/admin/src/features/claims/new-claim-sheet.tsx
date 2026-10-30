'use client';

import { type AdminClaimItem, AdminCreateClaimBody, ClaimCause } from '@clickco/contracts';
import {
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
  Textarea,
} from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { parseRupees } from '../../shared/money-labels';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError } from '../../shared/note-field';
import { CAUSE_LABEL, claimKeys } from './labels';

const FORM_ID = 'new-claim';

/** A datetime-local value ("2026-12-07T14:30", read as IST) → an ISO instant, or undefined. */
export function istLocalToIso(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}:00+05:30`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** A photographer reports damaged gear; staff log it against the booking. */
export function NewClaimSheet({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (claim: AdminClaimItem) => void;
}) {
  const [reference, setReference] = useState('');
  const [when, setWhen] = useState('');
  const [cause, setCause] = useState<ClaimCause>('CLIENT');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);

  const check = AdminCreateClaimBody.safeParse({
    bookingReference: reference,
    incidentAt: istLocalToIso(when) ?? '',
    cause,
    description,
    claimedAmountPaise: parseRupees(amount) ?? 0,
    links: url.trim() ? [{ url: url.trim(), label }] : [],
  });
  const err = (field: string) => (touched ? fieldError(check, field) : null);
  const create = useAdminMutation({
    run: (vars: AdminCreateClaimBody, idem) => adminApi.care.claims.create(vars, idem),
    success: (_, c) => `Claim logged on ${c.bookingReference}`,
    invalidate: [claimKeys.all],
    onSuccess: onCreated,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) create.mutate(check.data);
  };

  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || create.isPending ? undefined : onClose())}
      size="lg"
      title="Log an equipment claim"
      description="The photographer on the booking is the claimant. Up to ₹2,00,000 per incident."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null}
            Log claim
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="Booking"
          htmlFor="claim-booking"
          hint="Like CLK-1004"
          error={err('bookingReference')}
        >
          <Input
            id="claim-booking"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="When it happened (IST)" htmlFor="claim-when" error={err('incidentAt')}>
            <Input
              id="claim-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
          </Field>
          <Field
            label="Amount claimed (₹)"
            htmlFor="claim-amount"
            error={err('claimedAmountPaise')}
          >
            <Input
              id="claim-amount"
              inputMode="decimal"
              placeholder="45,000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Caused by" htmlFor="claim-cause">
          <Select value={cause} onValueChange={(v) => setCause(ClaimCause.parse(v))}>
            <SelectTrigger id="claim-cause">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ClaimCause.options.map((c) => (
                <SelectItem key={c} value={c}>
                  {CAUSE_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="What was damaged and how"
          htmlFor="claim-description"
          error={err('description')}
        >
          <Textarea
            id="claim-description"
            rows={5}
            maxLength={4_000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Evidence link (optional, https)" htmlFor="claim-link">
            <Input
              id="claim-link"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label="What it is" htmlFor="claim-link-label">
            <Input
              id="claim-link-label"
              placeholder="Photos of the lens"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
        </div>
      </form>
    </SideSheet>
  );
}
