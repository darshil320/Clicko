'use client';

import { AdminCreateTicketBody, TicketCategory, TicketRaisedBy } from '@clickco/contracts';
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
import { formatDateTime } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError } from '../../shared/note-field';
import { CATEGORY_LABEL, RAISED_BY_LABEL, ticketKeys } from './labels';

/** "98250 12345" → "+919825012345"; anything else is passed on for the contract to judge. */
export function phoneE164(text: string): string | undefined {
  const digits = text.replace(/\D/g, '');
  if (digits === '') return undefined;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return text.trim();
}

const FORM_ID = 'new-ticket-form';

/** Log a ticket for a customer who called or emailed (the in-app entry point is S11). */
export function NewTicketSheet({
  onClose,
  onCreated,
}: {
  readonly onClose: () => void;
  readonly onCreated: (ticketId: string) => void;
}) {
  const [raisedBy, setRaisedBy] = useState<TicketRaisedBy>('USER');
  const [contactName, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [booking, setBooking] = useState('');
  const [category, setCategory] = useState<TicketCategory>('GRIEVANCE');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);

  const check = AdminCreateTicketBody.safeParse({
    raisedBy,
    contactName,
    contactPhone: phoneE164(phone),
    contactEmail: email.trim() === '' ? undefined : email.trim(),
    bookingReference: booking.trim() === '' ? undefined : booking,
    category,
    subject,
    message,
  });
  const err = (field: string) => (touched ? fieldError(check, field) : null);

  const create = useAdminMutation({
    run: (vars: AdminCreateTicketBody, idem) => adminApi.care.tickets.create(vars, idem),
    success: (_, t) => `${t.reference} created — reply by ${formatDateTime(t.ackDueAt)}`,
    invalidate: [ticketKeys.all],
    onSuccess: (t) => onCreated(t.id),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (check.success) create.mutate(check.data);
  };

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open || create.isPending ? undefined : onClose())}
      title="New ticket"
      description="The 48-hour reply and 30-day resolution clocks start now."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null}
            Create ticket
          </Button>
        </>
      }
    >
      <form id={FORM_ID} className="grid gap-4" onSubmit={submit} noValidate>
        <Field label="Who is it from?" htmlFor="ticket-raised-by">
          <Select value={raisedBy} onValueChange={(v) => setRaisedBy(TicketRaisedBy.parse(v))}>
            <SelectTrigger id="ticket-raised-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TicketRaisedBy.options.map((r) => (
                <SelectItem key={r} value={r}>
                  {RAISED_BY_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Their name" htmlFor="ticket-name" error={err('contactName')}>
          <Input id="ticket-name" value={contactName} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Phone"
            htmlFor="ticket-phone"
            hint="Phone or email"
            error={err('contactPhone')}
          >
            <Input
              id="ticket-phone"
              inputMode="tel"
              placeholder="98250 12345"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="Email (optional)" htmlFor="ticket-email" error={err('contactEmail')}>
            <Input
              id="ticket-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </div>
        <Field
          label="Booking (optional)"
          htmlFor="ticket-booking"
          hint="Like CLK-1004. Needed if you work in one city only."
          error={err('bookingReference')}
        >
          <Input id="ticket-booking" value={booking} onChange={(e) => setBooking(e.target.value)} />
        </Field>
        <Field label="What is it about?" htmlFor="ticket-category">
          <Select value={category} onValueChange={(v) => setCategory(TicketCategory.parse(v))}>
            <SelectTrigger id="ticket-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TicketCategory.options.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Subject" htmlFor="ticket-subject" error={err('subject')}>
          <Input
            id="ticket-subject"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field
          label="What they said"
          htmlFor="ticket-message"
          hint="In their words — this starts the conversation."
          error={err('message')}
        >
          <Textarea
            id="ticket-message"
            rows={5}
            maxLength={4_000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
      </form>
    </SideSheet>
  );
}
