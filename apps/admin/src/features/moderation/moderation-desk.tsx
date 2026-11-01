'use client';

import { AdminModerationFilter, type AdminModerationItem } from '@clickco/contracts';
import {
  Badge,
  Button,
  type ColumnDef,
  DataTable,
  PageHeader,
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
import { useNow } from '../../shared/use-now';
import {
  DECISION,
  FILTER_LABEL,
  moderationKeys,
  PERSON_KIND_LABEL,
  REASON_LABEL,
  reportedLabel,
  STATUS,
} from './labels';
import { ReportSheet } from './report-sheet';

const EMPTY: Readonly<Record<AdminModerationFilter, { title: string; description: string }>> = {
  OPEN: { title: 'All caught up', description: 'No report is waiting for a decision.' },
  DECIDED: { title: 'Nothing decided yet', description: 'Decided reports show up here.' },
  ALL: {
    title: 'No reports yet',
    description: 'Reports from clients and photographers show up here.',
  },
};

function columns(now: number): ReadonlyArray<ColumnDef<AdminModerationItem>> {
  return [
    {
      id: 'reported',
      header: 'What was reported',
      accessorFn: (r) => reportedLabel(r),
      cell: ({ row }) => (
        <div className="grid">
          <span className="font-semibold">{reportedLabel(row.original)}</span>
          <Muted>{row.original.cityName}</Muted>
        </div>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      accessorFn: (r) => REASON_LABEL[r.reason],
      cell: ({ row }) => (
        <div className="grid max-w-80 gap-1">
          <span>{REASON_LABEL[row.original.reason]}</span>
          {row.original.note ? (
            <span className="line-clamp-2 whitespace-normal text-muted-foreground text-sm">
              {row.original.note}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'reporter',
      header: 'Reported by',
      accessorFn: (r) => r.reporterName ?? '',
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.reporterName ?? 'Name not known'}</span>
          <Muted>{PERSON_KIND_LABEL[row.original.reporterKind]}</Muted>
        </div>
      ),
    },
    {
      id: 'booking',
      header: 'Booking',
      accessorFn: (r) => r.bookingReference ?? '',
      cell: ({ row }) =>
        row.original.bookingId && row.original.bookingReference ? (
          <BookingLink id={row.original.bookingId} reference={row.original.bookingReference} />
        ) : (
          <Muted>—</Muted>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (r) => r.status,
      cell: ({ row }) => (
        <div className="grid gap-1">
          <Badge variant={STATUS[row.original.status].tone}>
            {STATUS[row.original.status].label}
          </Badge>
          {row.original.decision ? <Muted>{DECISION[row.original.decision].done}</Muted> : null}
        </div>
      ),
    },
    {
      id: 'when',
      header: 'Reported',
      accessorFn: (r) => Date.parse(r.createdAt),
      cell: ({ row }) => <RelativeTime at={row.original.createdAt} now={now} />,
    },
  ];
}

/**
 * The moderation desk (ADR-0027 D4): reports of reviews, clients and photographers, oldest open
 * first. A row opens the report; the decision — hide, keep, warn or dismiss — closes it.
 */
export function ModerationDesk() {
  const [filter, setFilter] = useState<AdminModerationFilter>('OPEN');
  const [open, setOpen] = useState<AdminModerationItem | null>(null);
  const now = useNow();
  const list = usePagedList(moderationKeys.list(filter), (cursor) =>
    adminApi.moderation.reports.list({ cursor, status: filter }),
  );
  const cols = useMemo(() => columns(now), [now]);

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Moderation"
        description="Reviews, clients and photographers reported in the apps. Hide a review, keep it, warn the person or dismiss the report."
        actions={
          <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(AdminModerationFilter.parse(v))}
        className="mb-4"
      >
        <TabsList aria-label="Which reports">
          {AdminModerationFilter.options.map((f) => (
            <TabsTrigger key={f} value={f}>
              {FILTER_LABEL[f]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={filter}
        caption={`${FILTER_LABEL[filter]} reports`}
        columns={cols}
        data={list.rows}
        getRowId={(r) => r.id}
        onRowClick={setOpen}
        rowLabel={(r) => `Open the report on ${reportedLabel(r)}`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={EMPTY[filter].title}
        emptyDescription={EMPTY[filter].description}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <ReportSheet key={open.id} item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
