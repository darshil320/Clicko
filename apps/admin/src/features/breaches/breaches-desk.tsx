'use client';

import { type AdminBreachItem, AdminBreachStatusFilter } from '@clickco/contracts';
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
import {
  formatBps,
  formatCode,
  formatDateTime,
  formatMinutes,
  formatMoney,
} from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { AttributeDialog } from './attribute-dialog';
import { WaiveDialog } from './waive-dialog';

type Action = { readonly kind: 'attribute' | 'waive'; readonly breach: AdminBreachItem };

const TAB_LABEL: Readonly<Record<AdminBreachStatusFilter, string>> = {
  OPEN: 'Open',
  WAIVED: 'Waived',
  ALL: 'All',
};

function columns(act: (action: Action) => void): ReadonlyArray<ColumnDef<AdminBreachItem>> {
  return [
    {
      id: 'reference',
      header: 'Booking',
      accessorFn: (row) => row.reference,
      cell: ({ row }) => (
        <div className="grid">
          <BookingLink id={row.original.bookingId} reference={row.original.reference} />
          <Muted>{row.original.cityName}</Muted>
        </div>
      ),
    },
    {
      id: 'kind',
      header: 'Clock · late by',
      accessorFn: (row) => row.delayMinutes,
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatCode(row.original.kind)}</span>
          <Muted>{formatMinutes(row.original.delayMinutes)}</Muted>
        </div>
      ),
    },
    {
      id: 'remedy',
      header: 'Remedy · deduction',
      accessorFn: (row) => row.remedyPaise,
      cell: ({ row }) => (
        <div className="grid">
          <span>
            {formatCode(row.original.remedyKind)} · {formatMoney(row.original.remedyPaise, true)}
          </span>
          <Muted>{formatBps(row.original.payoutDeductionBps)} off the payout</Muted>
        </div>
      ),
    },
    {
      id: 'attributedTo',
      header: 'Attributed to',
      accessorFn: (row) => row.attributedTo,
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatCode(row.original.attributedTo)}</span>
          <Muted>{row.original.photographerName ?? 'No photographer'}</Muted>
        </div>
      ),
    },
    {
      id: 'state',
      header: 'State',
      enableSorting: false,
      cell: ({ row }) => {
        const b = row.original;
        return (
          <div className="grid gap-1">
            {b.waived ? (
              <Badge variant="neutral">Waived</Badge>
            ) : b.applied ? (
              <Badge variant="success">Applied</Badge>
            ) : (
              <Badge variant="warning">Open</Badge>
            )}
            {b.waiveReason ? (
              <span className="block max-w-60 whitespace-normal text-muted-foreground text-sm">
                {b.waiveReason}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Breached',
      accessorFn: (row) => Date.parse(row.createdAt),
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.waived || row.original.applied ? null : (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => act({ kind: 'attribute', breach: row.original })}
            >
              Attribute
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => act({ kind: 'waive', breach: row.original })}
            >
              Waive
            </Button>
          </div>
        ),
    },
  ];
}

/** The SLA breach board (ADR-0025 D5): attribute or waive. No money moves here (S10). */
export function BreachesDesk() {
  const [status, setStatus] = useState<AdminBreachStatusFilter>('OPEN');
  const [action, setAction] = useState<Action | null>(null);
  const list = usePagedList(keys.breaches(status), (cursor) =>
    adminApi.breaches.list({ cursor, status }),
  );
  const cols = useMemo(() => columns(setAction), []);

  return (
    <>
      <PageHeader
        title="Breaches"
        description="Late SLA clocks. Say who caused the delay, or waive the breach. No money moves from this desk."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <Tabs
        value={status}
        onValueChange={(value) => setStatus(AdminBreachStatusFilter.parse(value))}
        className="mb-4"
      >
        <TabsList aria-label="Breach filter">
          {AdminBreachStatusFilter.options.map((option) => (
            <TabsTrigger key={option} value={option}>
              {TAB_LABEL[option]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={status}
        caption={`${TAB_LABEL[status]} breaches`}
        columns={cols}
        data={list.rows}
        getRowId={(row) => row.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={status === 'OPEN' ? 'No open breaches' : 'No breaches here'}
        emptyDescription="Every SLA clock that runs late shows up on this board."
        emptyAction={
          status === 'ALL' ? undefined : (
            <Button variant="outline" onClick={() => setStatus('ALL')}>
              Show all breaches
            </Button>
          )
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {action?.kind === 'attribute' ? (
        <AttributeDialog
          key={action.breach.id}
          breach={action.breach}
          onClose={() => setAction(null)}
        />
      ) : null}
      {action?.kind === 'waive' ? (
        <WaiveDialog
          key={action.breach.id}
          breach={action.breach}
          onClose={() => setAction(null)}
        />
      ) : null}
    </>
  );
}
