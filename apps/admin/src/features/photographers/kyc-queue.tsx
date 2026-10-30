'use client';

import type { AdminKycItem } from '@clickco/contracts';
import { Badge, type ColumnDef, DataTable, RelativeTime } from '@clickco/ui-web';
import { useMemo, useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { formatDay } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { useNow } from '../../shared/use-now';
import { KycSheet } from './kyc-sheet';
import { DOC_LABEL, PRO_STATUS, STAGE_LABEL, supplyKeys } from './labels';

function columns(now: number): ReadonlyArray<ColumnDef<AdminKycItem>> {
  return [
    {
      id: 'document',
      header: 'Document',
      accessorFn: (d) => d.kind,
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{DOC_LABEL[row.original.kind]}</span>
          <Muted>{row.original.referenceMasked ?? 'No number on file'}</Muted>
        </div>
      ),
    },
    {
      id: 'photographer',
      header: 'Photographer',
      accessorFn: (d) => d.photographerName,
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.photographerName}</span>
          <Muted>
            {row.original.cityName} ·{' '}
            {row.original.applicationStage && row.original.photographerStatus === 'APPLICANT'
              ? STAGE_LABEL[row.original.applicationStage]
              : PRO_STATUS[row.original.photographerStatus].label}
          </Muted>
        </div>
      ),
    },
    {
      id: 'expires',
      header: 'Valid until',
      accessorFn: (d) => d.expiresOn ?? '',
      cell: ({ row }) =>
        row.original.expiresOn ? formatDay(row.original.expiresOn) : <Muted>No expiry</Muted>,
    },
    {
      id: 'uploaded',
      header: 'Uploaded',
      accessorFn: (d) => Date.parse(d.uploadedAt),
      cell: ({ row }) => <RelativeTime at={row.original.uploadedAt} now={now} />,
    },
    {
      id: 'state',
      header: () => <span className="sr-only">State</span>,
      enableSorting: false,
      cell: () => <Badge variant="warning">To check</Badge>,
    },
  ];
}

/** KYC documents waiting for a decision, oldest first. */
export function KycQueue() {
  const [open, setOpen] = useState<AdminKycItem | null>(null);
  const now = useNow();
  const list = usePagedList(supplyKeys.kyc, (cursor) => adminApi.supply.kyc.list({ cursor }));
  const cols = useMemo(() => columns(now), [now]);
  return (
    <>
      <DataTable
        caption="Documents to check"
        columns={cols}
        data={list.rows}
        getRowId={(d) => d.id}
        onRowClick={setOpen}
        rowLabel={(d) => `Check ${d.photographerName}'s ${DOC_LABEL[d.kind]}`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="All caught up"
        emptyDescription="Every uploaded document has been checked."
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <KycSheet key={open.id} doc={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
