'use client';

import { type AdminReviewItem, AdminReviewStatusFilter } from '@clickco/contracts';
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
import { formatRupees, OUTCOME_LABEL } from '../../shared/money-labels';
import { usePagedList } from '../../shared/paged';
import { formatAgo } from '../../shared/relative-time';
import { useNow } from '../../shared/use-now';
import { SettleSheet } from './settle-sheet';

const TAB_LABEL: Readonly<Record<AdminReviewStatusFilter, string>> = {
  OPEN: 'To settle',
  SETTLED: 'Settled',
  ALL: 'All',
};

/** "Refund ₹8,454 + ₹500 credit", "No action". */
export function outcomeText(o: {
  outcome: AdminReviewItem['suggestion']['outcome'];
  amountPaise: number | null;
  creditPaise?: number;
}): string {
  const base = OUTCOME_LABEL[o.outcome];
  const amount =
    o.outcome === 'NO_ACTION' || o.amountPaise === null ? '' : ` ${formatRupees(o.amountPaise)}`;
  const extra = o.creditPaise ? ` + ${formatRupees(o.creditPaise)} credit` : '';
  return `${base}${amount}${extra}`;
}

function columns(now: number): ReadonlyArray<ColumnDef<AdminReviewItem>> {
  return [
    {
      id: 'title',
      header: 'What happened',
      accessorFn: (r) => r.title,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-medium">{row.original.title}</span>
          <Muted>
            <span title={formatDateTime(row.original.raisedAt)}>
              {formatAgo(row.original.raisedAt, now)}
            </span>
          </Muted>
        </div>
      ),
    },
    {
      id: 'booking',
      header: 'Booking',
      accessorFn: (r) => r.reference ?? '',
      cell: ({ row }) =>
        row.original.bookingId && row.original.reference ? (
          <div className="grid">
            <BookingLink id={row.original.bookingId} reference={row.original.reference} />
            <Muted>
              {row.original.clientName} · {row.original.cityName}
            </Muted>
          </div>
        ) : (
          <Muted>Not about a booking</Muted>
        ),
    },
    {
      id: 'decision',
      header: 'Suggested · decided',
      enableSorting: false,
      cell: ({ row }) => {
        const r = row.original.resolution;
        return r ? (
          <div className="grid gap-1">
            <Badge variant="success">{outcomeText(r)}</Badge>
            <Muted>by {r.resolvedBy.name}</Muted>
          </div>
        ) : (
          <Badge variant="outline">{outcomeText(row.original.suggestion)}</Badge>
        );
      },
    },
  ];
}

/** "To settle" (ADR-0026 D2, D8): review items with a suggested outcome, each settled once. */
export function ReviewsDesk() {
  const [status, setStatus] = useState<AdminReviewStatusFilter>('OPEN');
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow();
  const list = usePagedList(['money', 'reviews', status], (cursor) =>
    adminApi.money.reviews.list({ cursor, status }),
  );
  const cols = useMemo(() => columns(now), [now]);
  const open = list.rows.find((r) => r.eventId === openId) ?? null;

  return (
    <>
      <PageHeader
        title="To settle"
        description="Refunds, credits and charges the system flagged. Each one is settled once, with a note."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <Tabs
        value={status}
        onValueChange={(v) => setStatus(AdminReviewStatusFilter.parse(v))}
        className="mb-4"
      >
        <TabsList aria-label="Item filter">
          {AdminReviewStatusFilter.options.map((option) => (
            <TabsTrigger key={option} value={option}>
              {TAB_LABEL[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={status}
        caption={`${TAB_LABEL[status]} items`}
        columns={cols}
        data={list.rows}
        getRowId={(r) => r.eventId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        onRowClick={(r) => setOpenId(r.eventId)}
        rowLabel={(r) => `Open: ${r.title}${r.reference ? ` on ${r.reference}` : ''}`}
        emptyTitle={status === 'OPEN' ? 'All caught up' : 'Nothing here yet'}
        emptyDescription={
          status === 'OPEN'
            ? 'Nothing is waiting to be settled. New items appear here when a booking needs a money decision.'
            : 'Settled items are kept here with who decided and why.'
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <SettleSheet key={open.eventId} item={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}
