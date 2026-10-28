'use client';

import type { AdminAlert } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  RefreshCwIcon,
} from '@clickco/ui-web';
import { adminApi } from '../../shared/api';
import { BookingLink, Muted } from '../../shared/cells';
import { formatCode, formatDateTime } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { alertTone } from '../../shared/tones';

const REFRESH_MS = 60_000;

const COLUMNS: ReadonlyArray<ColumnDef<AdminAlert>> = [
  {
    id: 'type',
    header: 'Alert',
    accessorFn: (row) => row.type,
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        <Badge variant={alertTone(row.original.type)}>{formatCode(row.original.type)}</Badge>
        {row.original.reason ? (
          <Badge variant="outline">{formatCode(row.original.reason)}</Badge>
        ) : null}
      </div>
    ),
  },
  {
    id: 'summary',
    header: 'What happened',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="block max-w-xl whitespace-normal">{row.original.summary}</span>
    ),
  },
  {
    id: 'booking',
    header: 'Booking',
    accessorFn: (row) => row.bookingReference ?? '',
    cell: ({ row }) =>
      row.original.bookingId && row.original.bookingReference ? (
        <BookingLink id={row.original.bookingId} reference={row.original.bookingReference} />
      ) : (
        <Muted>—</Muted>
      ),
  },
  {
    id: 'occurredAt',
    header: 'When',
    accessorFn: (row) => Date.parse(row.occurredAt),
    cell: ({ row }) => formatDateTime(row.original.occurredAt),
  },
];

/** The alert feed (ADR-0025 D5): ops alerts and review flags, newest first. Settling is S10. */
export function AlertsFeed() {
  const list = usePagedList(keys.alerts, (cursor) => adminApi.alerts.list({ cursor }), {
    refetchInterval: REFRESH_MS,
  });

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Ops alerts and needs-review flags in your cities, newest first."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <DataTable
        caption="Alerts"
        columns={COLUMNS}
        data={list.rows}
        getRowId={(row) => row.eventId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="No alerts"
        emptyDescription="Dispatch failures, SLA risks and review flags appear here."
        emptyAction={
          <Button variant="outline" onClick={list.retry}>
            Check again
          </Button>
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
    </>
  );
}
