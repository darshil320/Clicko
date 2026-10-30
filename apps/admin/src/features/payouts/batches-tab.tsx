'use client';

import type { AdminPayoutBatchSummary } from '@clickco/contracts';
import { Badge, type ColumnDef, DataTable, RelativeTime } from '@clickco/ui-web';
import { useMemo } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { usePagedList } from '../../shared/paged';
import { useNow } from '../../shared/use-now';
import { BATCH_STATE, count, rupees } from './labels';
import { payoutKeys } from './shared';

function columns(now: number): ReadonlyArray<ColumnDef<AdminPayoutBatchSummary>> {
  return [
    {
      id: 'reference',
      header: 'Batch',
      accessorFn: (b) => b.reference,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{row.original.reference}</span>
          <Muted>{row.original.kind === 'WEEKLY' ? 'Weekly run' : 'Off-cycle'}</Muted>
        </div>
      ),
    },
    {
      id: 'state',
      header: 'Status',
      accessorFn: (b) => b.state,
      cell: ({ row }) => {
        const b = row.original;
        const s = BATCH_STATE[b.state];
        return (
          <div className="grid gap-1">
            <Badge variant={s.tone}>{s.label}</Badge>
            {b.transfersFailed > 0 ? (
              <Badge variant="destructive">{count(b.transfersFailed, 'failed transfer')}</Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      id: 'payees',
      header: 'Photographers',
      accessorFn: (b) => b.payeeCount,
      cell: ({ row }) => count(row.original.payeeCount, 'photographer'),
    },
    {
      id: 'net',
      header: 'To the bank',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{rupees(row.original.netPaise)}</span>
          <Muted>TDS {rupees(row.original.tdsPaise)}</Muted>
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Made',
      accessorFn: (b) => Date.parse(b.createdAt),
      cell: ({ row }) => <RelativeTime at={row.original.createdAt} now={now} />,
    },
  ];
}

/** Every batch, newest first. A batch opens on its own page (a long record, D8). */
export function BatchesTab({ onOpenBatch }: { readonly onOpenBatch: (id: string) => void }) {
  const now = useNow();
  const list = usePagedList(payoutKeys.batches, (cursor) =>
    adminApi.payouts.batches.list({ cursor, limit: 25 }),
  );
  const cols = useMemo(() => columns(now), [now]);
  return (
    <DataTable
      caption="Payout batches"
      columns={cols}
      data={list.rows}
      getRowId={(b) => b.id}
      isLoading={list.isLoading}
      error={list.error}
      onRetry={list.retry}
      onRowClick={(b) => onOpenBatch(b.id)}
      rowLabel={(b) => `Open batch ${b.reference}`}
      emptyTitle="No batches yet"
      emptyDescription="Each Monday's batch, and any off-cycle one, shows up here."
      hasMore={list.hasMore}
      isLoadingMore={list.isLoadingMore}
      onLoadMore={list.loadMore}
    />
  );
}
