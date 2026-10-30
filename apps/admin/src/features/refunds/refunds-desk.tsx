'use client';

import { type AdminRefundItem, AdminRefundStatusFilter } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  RefreshCwIcon,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink, Muted } from '../../shared/cells';
import { formatDateTime } from '../../shared/format';
import { formatRupees, REFUND_REASON_LABEL, REFUND_STATUS } from '../../shared/money-labels';
import { usePagedList } from '../../shared/paged';
import { formatAgo } from '../../shared/relative-time';
import { useNow } from '../../shared/use-now';
import { RefundSheet } from './refund-sheet';

export const REFUNDS_KEY = ['money', 'refunds'] as const;

const TAB_LABEL: Readonly<Record<AdminRefundStatusFilter, string>> = {
  AWAITING_APPROVAL: 'To approve',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  ALL: 'All',
};

const EMPTY: Readonly<Record<AdminRefundStatusFilter, { title: string; line: string }>> = {
  AWAITING_APPROVAL: {
    title: 'All caught up',
    line: 'No refund is waiting for approval. New requests show up here.',
  },
  IN_PROGRESS: {
    title: 'Nothing in progress',
    line: 'Approved refunds show here until the bank confirms.',
  },
  DONE: { title: 'No refunds yet', line: 'Refunded and rejected requests are kept here.' },
  ALL: {
    title: 'No refunds yet',
    line: 'Ask for a refund from the "To settle" desk or a booking.',
  },
};

function columns(now: number): ReadonlyArray<ColumnDef<AdminRefundItem>> {
  return [
    {
      id: 'booking',
      header: 'Booking',
      accessorFn: (r) => r.reference,
      cell: ({ row }) => (
        <div className="grid">
          <BookingLink id={row.original.bookingId} reference={row.original.reference} />
          <Muted>
            {row.original.clientName} · {row.original.cityName}
          </Muted>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      accessorFn: (r) => r.amountPaise,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{formatRupees(row.original.amountPaise)}</span>
          <Muted>{row.original.paidWith}</Muted>
        </div>
      ),
    },
    {
      id: 'reason',
      header: 'Why',
      accessorFn: (r) => r.reason,
      cell: ({ row }) => REFUND_REASON_LABEL[row.original.reason],
    },
    {
      id: 'requested',
      header: 'Asked by',
      accessorFn: (r) => Date.parse(r.requestedAt),
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.requestedBy.name}</span>
          <Muted>
            <span title={formatDateTime(row.original.requestedAt)}>
              {formatAgo(row.original.requestedAt, now)}
            </span>
          </Muted>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (r) => r.status,
      cell: ({ row }) => (
        <Badge variant={REFUND_STATUS[row.original.status].tone}>
          {REFUND_STATUS[row.original.status].label}
        </Badge>
      ),
    },
  ];
}

/** Refunds (ADR-0026 D1, D8): the approval queue (oldest first), in progress and done. */
export function RefundsDesk() {
  const [status, setStatus] = useState<AdminRefundStatusFilter>('AWAITING_APPROVAL');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow();
  const list = usePagedList([...REFUNDS_KEY, status], (cursor) =>
    adminApi.money.refunds.list({ cursor, status }),
  );
  const cols = useMemo(() => columns(now), [now]);
  const open = list.rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <PageHeader
        title="Refunds"
        description="Every refund needs a second person to approve it. Approved refunds go straight back to the client's payment method."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <Tabs
        value={status}
        onValueChange={(v) => setStatus(AdminRefundStatusFilter.parse(v))}
        className="mb-4"
      >
        <TabsList aria-label="Refund filter">
          {AdminRefundStatusFilter.options.map((option) => (
            <TabsTrigger key={option} value={option}>
              {TAB_LABEL[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={status}
        caption={`${TAB_LABEL[status]} refunds`}
        columns={cols}
        data={list.rows}
        getRowId={(r) => r.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        onRowClick={(r) => setOpenId(r.id)}
        rowLabel={(r) => `Open the refund of ${formatRupees(r.amountPaise)} for ${r.reference}`}
        emptyTitle={EMPTY[status].title}
        emptyDescription={EMPTY[status].line}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <RefundSheet key={open.id} refund={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
