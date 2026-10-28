'use client';

import type { AdminQaItem, QaResult } from '@clickco/contracts';
import { Button, type ColumnDef, DataTable, PageHeader, RefreshCwIcon } from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { BookingLink, DueCell, Muted } from '../../shared/cells';
import { formatCode, formatDateTime } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { useNow } from '../../shared/use-now';
import { DecideDialog } from './decide-dialog';

const REFRESH_MS = 60_000;

function columns(
  now: number,
  decide: (item: AdminQaItem, result: QaResult) => void,
): ReadonlyArray<ColumnDef<AdminQaItem>> {
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
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatCode(row.original.categoryCode)}</span>
          <Muted>{formatCode(row.original.tier)}</Muted>
        </div>
      ),
    },
    { id: 'photographer', header: 'Photographer', accessorFn: (row) => row.photographerName },
    {
      id: 'checkedOut',
      header: 'Checked out',
      accessorFn: (row) => (row.checkedOutAt ? Date.parse(row.checkedOutAt) : 0),
      cell: ({ row }) =>
        row.original.checkedOutAt ? formatDateTime(row.original.checkedOutAt) : <Muted>—</Muted>,
    },
    {
      id: 'files',
      header: 'Files',
      enableSorting: false,
      cell: ({ row }) => {
        const { counts, declaredFrameCount } = row.original;
        return (
          <div className="grid">
            <span>
              {counts.raw} RAW · {counts.jpeg} JPEG · {counts.video} video
            </span>
            <Muted>
              {declaredFrameCount === null
                ? 'No frame count declared'
                : `${declaredFrameCount} frames declared`}
            </Muted>
          </div>
        );
      },
    },
    {
      id: 'due',
      header: 'Production due',
      accessorFn: (row) => (row.dueAt ? Date.parse(row.dueAt) : Number.POSITIVE_INFINITY),
      cell: ({ row }) => <DueCell at={row.original.dueAt} now={now} />,
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Decide</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={() => decide(row.original, 'PASS')}>
            Pass
          </Button>
          <Button size="sm" variant="outline" onClick={() => decide(row.original, 'FAIL')}>
            Fail
          </Button>
        </div>
      ),
    },
  ];
}

/** The QA desk (ADR-0025 D5): deliveries waiting for a check, oldest due first. */
export function QaDesk() {
  const now = useNow();
  const [decision, setDecision] = useState<{ item: AdminQaItem; result: QaResult } | null>(null);
  const list = usePagedList(keys.qa, (cursor) => adminApi.qa.list({ cursor }), {
    refetchInterval: REFRESH_MS,
  });
  const cols = useMemo(() => columns(now, (item, result) => setDecision({ item, result })), [now]);

  return (
    <>
      <PageHeader
        title="QA"
        description="Deliveries waiting for a check, oldest due first. QA time counts against the production clock."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <DataTable
        caption="QA queue"
        columns={cols}
        data={list.rows}
        getRowId={(row) => row.bookingId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="Nothing waiting for QA"
        emptyDescription="New deliveries appear here when processing finishes."
        emptyAction={
          <Button variant="outline" onClick={list.retry}>
            Check again
          </Button>
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {decision ? (
        <DecideDialog
          key={`${decision.item.bookingId}-${decision.result}`}
          item={decision.item}
          result={decision.result}
          onClose={() => setDecision(null)}
        />
      ) : null}
    </>
  );
}
