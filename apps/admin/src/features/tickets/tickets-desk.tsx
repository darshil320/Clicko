'use client';

import { type AdminTicketItem, AdminTicketView, CARE_ACTION_ROLES } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  PlusIcon,
  RefreshCwIcon,
  RelativeTime,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { usePagedList } from '../../shared/paged';
import { useCan } from '../../shared/use-can';
import { useNow } from '../../shared/use-now';
import { deadlineChip } from './deadline';
import { CATEGORY_LABEL, STATUS, ticketKeys, VIEW_LABEL } from './labels';
import { NewTicketSheet } from './new-ticket-sheet';
import { TicketSheet } from './ticket-sheet';

const EMPTY: Readonly<Record<AdminTicketView, { title: string; description: string }>> = {
  OPEN: { title: 'All caught up', description: 'Every ticket has been resolved.' },
  MINE: {
    title: 'Nothing assigned to you',
    description: 'Pick a ticket and choose "Assign to me".',
  },
  OVERDUE: {
    title: 'Nothing overdue',
    description: 'Every open ticket is inside its 48-hour and 30-day deadlines.',
  },
  RESOLVED: { title: 'No resolved tickets yet', description: 'Resolved tickets show up here.' },
};

function columns(now: number): ReadonlyArray<ColumnDef<AdminTicketItem>> {
  return [
    {
      id: 'ticket',
      header: 'Ticket',
      accessorFn: (t) => t.reference,
      cell: ({ row }) => (
        <div className="grid max-w-80 gap-1">
          <span className="truncate font-semibold">{row.original.subject}</span>
          <Muted>
            {row.original.reference} · {CATEGORY_LABEL[row.original.category]}
          </Muted>
        </div>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      accessorFn: (t) => t.contactName,
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.contactName}</span>
          <Muted>{row.original.bookingReference ?? 'No booking'}</Muted>
        </div>
      ),
    },
    {
      id: 'deadline',
      header: 'Deadline',
      enableSorting: false,
      cell: ({ row }) => {
        const chip = deadlineChip(row.original, now);
        return <Badge variant={chip.tone}>{chip.label}</Badge>;
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (t) => t.status,
      cell: ({ row }) => (
        <Badge variant={STATUS[row.original.status].tone}>
          {STATUS[row.original.status].label}
        </Badge>
      ),
    },
    {
      id: 'assigned',
      header: 'With',
      accessorFn: (t) => t.assignedToName ?? '',
      cell: ({ row }) => row.original.assignedToName ?? <Muted>Nobody yet</Muted>,
    },
    {
      id: 'received',
      header: 'Received',
      accessorFn: (t) => Date.parse(t.receivedAt),
      cell: ({ row }) => <RelativeTime at={row.original.receivedAt} now={now} />,
    },
  ];
}

/**
 * Support tickets (SA-02, ADR-0026 D6): every ticket shows its legal deadline — reply within
 * 48 hours, resolve within 30 days — as a chip that turns amber when close and red when late.
 */
export function TicketsDesk() {
  const [view, setView] = useState<AdminTicketView>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const now = useNow();
  const canWork = useCan(CARE_ACTION_ROLES.workTickets)();
  const list = usePagedList(ticketKeys.list(view), (cursor) =>
    adminApi.care.tickets.list({ cursor, view }),
  );
  const cols = useMemo(() => columns(now), [now]);

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Support tickets"
        description="Reply within 48 hours and resolve within 30 days of receipt — the law's deadlines (Consumer Protection E-Commerce Rules)."
        actions={
          <>
            <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
              <RefreshCwIcon />
              Refresh
            </Button>
            {canWork ? (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon />
                New ticket
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs value={view} onValueChange={(v) => setView(AdminTicketView.parse(v))} className="mb-4">
        <TabsList aria-label="Which tickets">
          {AdminTicketView.options.map((v) => (
            <TabsTrigger key={v} value={v}>
              {VIEW_LABEL[v]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={view}
        caption={`${VIEW_LABEL[view]} tickets`}
        columns={cols}
        data={list.rows}
        getRowId={(t) => t.id}
        onRowClick={(t) => setOpenId(t.id)}
        rowLabel={(t) => `Open ticket ${t.reference}`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={EMPTY[view].title}
        emptyDescription={EMPTY[view].description}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {openId ? (
        <TicketSheet
          key={openId}
          ticketId={openId}
          canWork={canWork}
          onClose={() => setOpenId(null)}
        />
      ) : null}
      {creating ? (
        <NewTicketSheet
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </>
  );
}
