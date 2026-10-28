'use client';

import type { AdminIncidentItem } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  RefreshCwIcon,
} from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink, Muted } from '../../shared/cells';
import { formatCode, formatDateTime } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { bookingTone, incidentTone } from '../../shared/tones';
import { ConfirmIncidentDialog } from './confirm-dialog';

const REFRESH_MS = 60_000;

function columns(
  onConfirm: (item: AdminIncidentItem) => void,
): ReadonlyArray<ColumnDef<AdminIncidentItem>> {
  return [
    {
      id: 'kind',
      header: 'Report',
      accessorFn: (row) => row.kind,
      cell: ({ row }) => (
        <Badge variant={incidentTone(row.original.kind)}>{formatCode(row.original.kind)}</Badge>
      ),
    },
    {
      id: 'reference',
      header: 'Booking',
      accessorFn: (row) => row.reference,
      cell: ({ row }) => (
        <div className="grid gap-1">
          <BookingLink id={row.original.bookingId} reference={row.original.reference} />
          <Badge variant={bookingTone(row.original.bookingStatus)}>
            {formatCode(row.original.bookingStatus)}
          </Badge>
        </div>
      ),
    },
    { id: 'city', header: 'City', accessorFn: (row) => row.cityName },
    { id: 'photographer', header: 'Photographer', accessorFn: (row) => row.photographerName },
    {
      id: 'note',
      header: 'Their note',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="block max-w-80 whitespace-normal">
          {row.original.note ?? <Muted>No note</Muted>}
        </span>
      ),
    },
    {
      id: 'reportedAt',
      header: 'Reported',
      accessorFn: (row) => Date.parse(row.reportedAt),
      cell: ({ row }) => formatDateTime(row.original.reportedAt),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Confirm</span>,
      enableSorting: false,
      cell: ({ row }) =>
        row.original.kind === 'CLIENT_ABSENT' ? (
          <Muted>Settled by finance</Muted>
        ) : (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onConfirm(row.original)}>
              Confirm
            </Button>
          </div>
        ),
    },
  ];
}

/** The incident desk (ADR-0025 D5): on-site reports not yet confirmed by staff. */
export function IncidentsDesk() {
  const [confirming, setConfirming] = useState<AdminIncidentItem | null>(null);
  const list = usePagedList(keys.incidents, (cursor) => adminApi.incidents.list({ cursor }), {
    refetchInterval: REFRESH_MS,
  });
  const cols = useMemo(() => columns(setConfirming), []);

  return (
    <>
      <PageHeader
        title="Incidents"
        description="Access denied and unsafe-site reports waiting for a staff check. Client-absent reports are listed for visibility; their outcome is a money decision."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <DataTable
        caption="Unconfirmed incidents"
        columns={cols}
        data={list.rows}
        getRowId={(row) => row.eventId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="No incidents to confirm"
        emptyDescription="Photographers’ on-site reports appear here."
        emptyAction={
          <Button variant="outline" onClick={list.retry}>
            Check again
          </Button>
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {confirming && confirming.kind !== 'CLIENT_ABSENT' ? (
        <ConfirmIncidentDialog
          key={confirming.eventId}
          item={confirming}
          kind={confirming.kind}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
