'use client';

import { AdminQualityFilter, type AdminQualityItem, CARE_ACTION_ROLES } from '@clickco/contracts';
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
import { BookingLink, Muted } from '../../shared/cells';
import { usePagedList } from '../../shared/paged';
import { useCan } from '../../shared/use-can';
import { useNow } from '../../shared/use-now';
import { FILTER_LABEL, OUTCOME_LABEL, qualityKeys, STATUS } from './labels';
import { OpenIssueSheet } from './open-issue-sheet';
import { QualitySheet } from './quality-sheet';

function columns(now: number): ReadonlyArray<ColumnDef<AdminQualityItem>> {
  return [
    {
      id: 'booking',
      header: 'Booking',
      accessorFn: (q) => q.reference,
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
      id: 'complaint',
      header: 'What is wrong',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="line-clamp-2 block max-w-96 whitespace-normal">
          {row.original.complaint}
        </span>
      ),
    },
    {
      id: 'photographer',
      header: 'Photographer',
      accessorFn: (q) => q.photographerName ?? '',
      cell: ({ row }) => row.original.photographerName ?? <Muted>—</Muted>,
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (q) => q.status,
      cell: ({ row }) => (
        <div className="grid gap-1">
          <Badge variant={STATUS[row.original.status].tone}>
            {STATUS[row.original.status].label}
          </Badge>
          {row.original.outcome ? <Muted>{OUTCOME_LABEL[row.original.outcome]}</Muted> : null}
          {row.original.assignedQmName && !row.original.outcome ? (
            <Muted>With {row.original.assignedQmName}</Muted>
          ) : null}
        </div>
      ),
    },
    {
      id: 'raised',
      header: 'Raised',
      accessorFn: (q) => Date.parse(q.createdAt),
      cell: ({ row }) => <RelativeTime at={row.original.createdAt} now={now} />,
    },
  ];
}

/** The Quality Manager's queue (ADR-0026 D6): complaints on delivered shoots, oldest first. */
export function QualityDesk() {
  const [filter, setFilter] = useState<AdminQualityFilter>('OPEN');
  const [open, setOpen] = useState<AdminQualityItem | null>(null);
  const [logging, setLogging] = useState(false);
  const now = useNow();
  const canOpen = useCan(CARE_ACTION_ROLES.openQuality)();
  const list = usePagedList(qualityKeys.list(filter), (cursor) =>
    adminApi.care.quality.list({ cursor, status: filter }),
  );
  const cols = useMemo(() => columns(now), [now]);

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Quality issues"
        description="Client complaints about delivered photos. The Quality Manager decides: a credit, a partial refund, a reshoot or no action."
        actions={
          <>
            <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
              <RefreshCwIcon />
              Refresh
            </Button>
            {canOpen ? (
              <Button onClick={() => setLogging(true)}>
                <PlusIcon />
                Log a complaint
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(AdminQualityFilter.parse(v))}
        className="mb-4"
      >
        <TabsList aria-label="Which issues">
          {AdminQualityFilter.options.map((f) => (
            <TabsTrigger key={f} value={f}>
              {FILTER_LABEL[f]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={filter}
        caption={`${FILTER_LABEL[filter]} quality issues`}
        columns={cols}
        data={list.rows}
        getRowId={(q) => q.id}
        onRowClick={setOpen}
        rowLabel={(q) => `Open the quality issue on ${q.reference}`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={filter === 'OPEN' ? 'All caught up' : 'Nothing here yet'}
        emptyDescription={
          filter === 'OPEN'
            ? 'No complaint is waiting for the Quality Manager.'
            : 'Decided issues show up here.'
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <QualitySheet key={open.id} issue={open} onClose={() => setOpen(null)} /> : null}
      {logging ? (
        <OpenIssueSheet
          onClose={() => setLogging(false)}
          onOpened={(issue) => {
            setLogging(false);
            setOpen(issue);
          }}
        />
      ) : null}
    </>
  );
}
