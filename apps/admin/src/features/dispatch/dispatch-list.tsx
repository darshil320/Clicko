'use client';

import type { AdminDispatchItem } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
  RefreshCwIcon,
} from '@clickco/ui-web';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink, DueCell, Muted } from '../../shared/cells';
import { formatCode, formatDateTime, formatEmergencyBand } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { emergencyTone } from '../../shared/tones';
import { useNow } from '../../shared/use-now';

const REFRESH_MS = 30_000;

function columns(now: number): ReadonlyArray<ColumnDef<AdminDispatchItem>> {
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
      id: 'plan',
      header: 'Plan',
      accessorFn: (row) => row.categoryCode,
      cell: ({ row }) => {
        const emergency = emergencyTone(row.original.emergencyBand);
        return (
          <div className="grid gap-1">
            <span>
              {formatCode(row.original.categoryCode)} · {formatCode(row.original.tier)}
            </span>
            {emergency ? (
              <Badge variant={emergency}>{formatEmergencyBand(row.original.emergencyBand)}</Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'start',
      header: 'Shoot',
      accessorFn: (row) => Date.parse(row.scheduledStart),
      cell: ({ row }) => formatDateTime(row.original.scheduledStart),
    },
    {
      id: 'wave',
      header: 'Wave · offers',
      accessorFn: (row) => row.wave,
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>
            Wave {row.original.wave} · {row.original.pendingOffers} open
          </span>
          {row.original.exhausted ? <Badge variant="destructive">Exhausted</Badge> : null}
        </div>
      ),
    },
    {
      id: 'deadline',
      header: 'Unfilled deadline',
      accessorFn: (row) => Date.parse(row.deadlineAt),
      cell: ({ row }) => <DueCell at={row.original.deadlineAt} now={now} />,
    },
  ];
}

/** The dispatch desk (ADR-0025 D5): bookings looking for a photographer. View only in S9. */
export function DispatchList() {
  const router = useRouter();
  const now = useNow();
  const list = usePagedList(keys.dispatch, (cursor) => adminApi.dispatch.list({ cursor }), {
    refetchInterval: REFRESH_MS,
  });
  const cols = useMemo(() => columns(now), [now]);

  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Bookings still looking for a photographer. The booking is cancelled as unfilled 90 minutes before the shoot."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <DataTable
        caption="Bookings in dispatch"
        columns={cols}
        data={list.rows}
        getRowId={(row) => row.bookingId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="Nothing in dispatch"
        emptyDescription="Every confirmed booking has a photographer."
        emptyAction={
          <Button variant="outline" onClick={list.retry}>
            Check again
          </Button>
        }
        onRowClick={(row) => router.push(`/dispatch/${row.bookingId}`)}
        rowLabel={(row) => `Open dispatch for ${row.reference}`}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
    </>
  );
}
