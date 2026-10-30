'use client';

import { AdminOpenQualityBody, type AdminQualityItem } from '@clickco/contracts';
import { Button, Field, Input, SideSheet, Spinner, Textarea } from '@clickco/ui-web';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError } from '../../shared/note-field';
import { keys } from '../../shared/query';
import { qualityKeys } from './labels';

const FORM_ID = 'open-quality-issue';

/** Log a client's complaint about a delivered shoot (the client app's own button is S11). */
export function OpenIssueSheet({
  onClose,
  onOpened,
}: {
  readonly onClose: () => void;
  readonly onOpened: (issue: AdminQualityItem) => void;
}) {
  const [reference, setReference] = useState('');
  const [complaint, setComplaint] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminOpenQualityBody.safeParse({ bookingReference: reference, complaint });
  const err = (field: string) => (touched ? fieldError(check, field) : null);
  const open = useAdminMutation({
    run: (vars: AdminOpenQualityBody, idem) => adminApi.care.quality.open(vars, idem),
    success: (_, issue) => `Complaint logged on ${issue.reference} for the Quality Manager`,
    invalidate: [qualityKeys.all, keys.bookingAll, keys.bookingsAll],
    onSuccess: onOpened,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) open.mutate(check.data);
  };
  return (
    <SideSheet
      open
      onOpenChange={(o) => (o || open.isPending ? undefined : onClose())}
      title="Log a complaint"
      description="Only for a delivered booking. The booking is held until the Quality Manager decides."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={open.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={open.isPending}>
            {open.isPending ? <Spinner /> : null}
            Log complaint
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        <Field
          label="Booking"
          htmlFor="quality-booking"
          hint="Like CLK-1004"
          error={err('bookingReference')}
        >
          <Input
            id="quality-booking"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </Field>
        <Field
          label="What is wrong?"
          htmlFor="quality-complaint"
          hint="In the client's words: which photos, what they expected."
          error={err('complaint')}
        >
          <Textarea
            id="quality-complaint"
            rows={6}
            maxLength={2_000}
            value={complaint}
            onChange={(e) => setComplaint(e.target.value)}
          />
        </Field>
      </form>
    </SideSheet>
  );
}
