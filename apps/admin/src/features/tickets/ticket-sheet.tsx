'use client';

import {
  AdminResolveTicketBody,
  type AdminTicketDetail,
  type AdminTicketMessage,
  AdminTicketMessageBody,
  isTicketDone,
} from '@clickco/contracts';
import {
  Badge,
  Button,
  ChatBubble,
  ChatThread,
  DescriptionItem,
  DescriptionList,
  Field,
  RelativeTime,
  SideSheet,
  Skeleton,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@clickco/ui-web';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { adminApi } from '../../shared/api';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { describeError } from '../../shared/errors';
import { formatDateTime, formatPhone } from '../../shared/format';
import { useAdminMutation } from '../../shared/mutation';
import { fieldError, NoteField } from '../../shared/note-field';
import { useNow } from '../../shared/use-now';
import { deadlineChip } from './deadline';
import { CATEGORY_LABEL, RAISED_BY_LABEL, STATUS, ticketKeys } from './labels';

type Kind = AdminTicketMessageBody['kind'];

const COMPOSER: Readonly<Record<Kind, { tab: string; label: string; send: string; hint: string }>> =
  {
    REPLY: {
      tab: 'Reply',
      label: 'Reply to the customer',
      send: 'Send reply',
      hint: 'Saved to the ticket. Until the app shows replies (S11), also send it by phone or WhatsApp.',
    },
    NOTE: {
      tab: 'Internal note',
      label: 'Note for the team',
      send: 'Add note',
      hint: 'Only staff see this.',
    },
    CUSTOMER: {
      tab: 'Customer said',
      label: 'What the customer told you',
      send: 'Log message',
      hint: 'For a call or an email, in their words.',
    },
  };

function bubbleOf(m: AdminTicketMessage, now: number) {
  const meta = <RelativeTime at={m.createdAt} now={now} />;
  if (m.authorKind === 'SYSTEM') {
    return (
      <ChatBubble key={m.id} kind="system" meta={meta}>
        {m.body}
      </ChatBubble>
    );
  }
  if (m.authorKind === 'CUSTOMER') {
    return (
      <ChatBubble key={m.id} kind="incoming" author={m.authorName ?? 'Customer'} meta={meta}>
        {m.body}
      </ChatBubble>
    );
  }
  return (
    <ChatBubble
      key={m.id}
      kind={m.isInternal ? 'internal' : 'outgoing'}
      author={m.authorName ?? 'Staff'}
      tag={m.isInternal ? 'Internal note' : undefined}
      meta={meta}
    >
      {m.body}
    </ChatBubble>
  );
}

/** One ticket: its deadlines, the conversation like a chat, and a reply box. */
export function TicketSheet({
  ticketId,
  canWork,
  onClose,
}: {
  readonly ticketId: string;
  readonly canWork: boolean;
  readonly onClose: () => void;
}) {
  const now = useNow();
  const query = useQuery({
    queryKey: ticketKeys.one(ticketId),
    queryFn: () => adminApi.care.tickets.get(ticketId),
  });
  const t = query.data;

  return (
    <SideSheet
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      size="xl"
      title={t ? t.subject : 'Ticket'}
      description={
        t
          ? `${t.reference} · ${CATEGORY_LABEL[t.category]} · received ${formatDateTime(t.receivedAt)}`
          : undefined
      }
      footer={t && canWork && !isTicketDone(t.status) ? <Composer ticket={t} /> : undefined}
    >
      {query.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : query.isError || !t ? (
        <p role="alert" className="text-destructive text-sm">
          {describeError(query.error).message}
        </p>
      ) : (
        <TicketBody ticket={t} now={now} canWork={canWork} />
      )}
    </SideSheet>
  );
}

function TicketBody({
  ticket: t,
  now,
  canWork,
}: {
  readonly ticket: AdminTicketDetail;
  readonly now: number;
  readonly canWork: boolean;
}) {
  const chip = deadlineChip(t, now);
  const done = isTicketDone(t.status);
  const [resolving, setResolving] = useState(false);
  const invalidate = [ticketKeys.all];
  const assign = useAdminMutation({
    run: (_: null, idem) => adminApi.care.tickets.assignToMe(t.id, idem),
    success: () => `${t.reference} is now with you`,
    invalidate,
  });
  const acknowledge = useAdminMutation({
    run: (_: null, idem) => adminApi.care.tickets.acknowledge(t.id, idem),
    success: () => `${t.reference} acknowledged`,
    invalidate,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={chip.tone}>{chip.label}</Badge>
        <Badge variant={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
        {t.isGrievance ? <Badge variant="outline">Formal grievance</Badge> : null}
      </div>
      <DescriptionList>
        <DescriptionItem term="Customer">
          {t.contactName} · {RAISED_BY_LABEL[t.raisedByKind]}
        </DescriptionItem>
        <DescriptionItem term="Reach them on">
          {[t.contactPhone ? formatPhone(t.contactPhone) : null, t.contactEmail]
            .filter(Boolean)
            .join(' · ')}
        </DescriptionItem>
        <DescriptionItem term="Booking">
          {t.bookingId && t.bookingReference ? (
            <Link
              className="font-semibold underline-offset-4 hover:underline"
              href={`/bookings/${t.bookingId}`}
            >
              {t.bookingReference}
            </Link>
          ) : (
            'None'
          )}
        </DescriptionItem>
        <DescriptionItem term="With">{t.assignedToName ?? 'Nobody yet'}</DescriptionItem>
        <DescriptionItem term="Reply by">
          {t.acknowledgedAt
            ? `Done ${formatDateTime(t.acknowledgedAt)}`
            : formatDateTime(t.ackDueAt)}
        </DescriptionItem>
        <DescriptionItem term="Resolve by">
          {t.resolvedAt ? `Done ${formatDateTime(t.resolvedAt)}` : formatDateTime(t.resolveDueAt)}
        </DescriptionItem>
      </DescriptionList>
      {canWork && !done ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={assign.isPending}
            onClick={() => assign.mutate(null)}
          >
            {assign.isPending ? <Spinner /> : null}
            Assign to me
          </Button>
          {t.acknowledgedAt === null ? (
            <Button
              variant="outline"
              size="sm"
              disabled={acknowledge.isPending}
              onClick={() => acknowledge.mutate(null)}
            >
              {acknowledge.isPending ? <Spinner /> : null}
              Mark acknowledged
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => setResolving(true)}>
            Resolve…
          </Button>
        </div>
      ) : null}
      {t.resolutionSummary ? (
        <p className="rounded-md border bg-muted p-3 text-sm">
          <span className="font-semibold">How it was resolved: </span>
          {t.resolutionSummary}
        </p>
      ) : null}
      <ChatThread>{t.messages.map((m) => bubbleOf(m, now))}</ChatThread>
      {resolving ? <ResolveDialog ticket={t} onClose={() => setResolving(false)} /> : null}
    </>
  );
}

function Composer({ ticket: t }: { readonly ticket: AdminTicketDetail }) {
  const [kind, setKind] = useState<Kind>('REPLY');
  const [body, setBody] = useState('');
  const check = AdminTicketMessageBody.safeParse({ kind, body });
  const send = useAdminMutation({
    run: (vars: AdminTicketMessageBody, idem) => adminApi.care.tickets.message(t.id, vars, idem),
    success: () =>
      kind === 'NOTE' ? 'Note added' : kind === 'REPLY' ? 'Reply saved' : 'Message logged',
    invalidate: [ticketKeys.all],
    onSuccess: () => setBody(''),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (check.success) send.mutate(check.data);
  };
  const c = COMPOSER[kind];
  return (
    <form className="grid w-full gap-3" onSubmit={submit} noValidate>
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList aria-label="Message type">
          {(Object.keys(COMPOSER) as Kind[]).map((k) => (
            <TabsTrigger key={k} value={k}>
              {COMPOSER[k].tab}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Field label={c.label} htmlFor="ticket-composer" hint={c.hint}>
        <Textarea
          id="ticket-composer"
          rows={3}
          maxLength={4_000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" disabled={send.isPending || !check.success}>
          {send.isPending ? <Spinner /> : null}
          {c.send}
        </Button>
      </div>
    </form>
  );
}

function ResolveDialog({
  ticket: t,
  onClose,
}: {
  readonly ticket: AdminTicketDetail;
  readonly onClose: () => void;
}) {
  const [summary, setSummary] = useState('');
  const [touched, setTouched] = useState(false);
  const check = AdminResolveTicketBody.safeParse({ summary });
  const resolve = useAdminMutation({
    run: (vars: AdminResolveTicketBody, idem) => adminApi.care.tickets.resolve(t.id, vars, idem),
    success: () => `${t.reference} resolved`,
    invalidate: [ticketKeys.all],
    onSuccess: onClose,
  });
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={`Resolve ${t.reference}?`}
      pending={resolve.isPending}
      confirmLabel="Resolve ticket"
      onConfirm={() => {
        setTouched(true);
        if (check.success) resolve.mutate(check.data);
      }}
      consequence={`${t.contactName}'s ticket closes and your summary is added to the conversation. Nothing more can be added after this.`}
    >
      <NoteField
        id="resolve-summary"
        label="How was it resolved?"
        required
        value={summary}
        onChange={setSummary}
        error={touched ? fieldError(check, 'summary') : null}
      />
    </ConfirmDialog>
  );
}
