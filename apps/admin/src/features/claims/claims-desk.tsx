'use client';

import { AdminClaimFilter, type AdminClaimItem, CARE_ACTION_ROLES } from '@clickco/contracts';
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
import { formatMoney } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { useCan } from '../../shared/use-can';
import { useNow } from '../../shared/use-now';
import { ClaimSheet } from './claim-sheet';
import { CAUSE_LABEL, claimKeys, FILTER_LABEL, STATUS } from './labels';
import { NewClaimSheet } from './new-claim-sheet';

function columns(now: number): ReadonlyArray<ColumnDef<AdminClaimItem>> {
  return [
    {
      id: 'booking',
      header: 'Booking',
      accessorFn: (c) => c.bookingReference,
      cell: ({ row }) => (
        <div className="grid">
          <BookingLink id={row.original.bookingId} reference={row.original.bookingReference} />
          <Muted>{row.original.cityName}</Muted>
        </div>
      ),
    },
    {
      id: 'photographer',
      header: 'Photographer',
      accessorFn: (c) => c.photographerName,
      cell: ({ row }) => (
        <div className="grid">
          <span>{row.original.photographerName}</span>
          <Muted>Caused by: {CAUSE_LABEL[row.original.cause].toLowerCase()}</Muted>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'Claimed · approved',
      accessorFn: (c) => c.claimedAmountPaise,
      cell: ({ row }) => (
        <div className="grid">
          <span>{formatMoney(row.original.claimedAmountPaise)}</span>
          {row.original.approvedAmountPaise !== null ? (
            <Muted>{formatMoney(row.original.approvedAmountPaise)} approved</Muted>
          ) : null}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorFn: (c) => c.status,
      cell: ({ row }) => (
        <Badge variant={STATUS[row.original.status].tone}>
          {STATUS[row.original.status].label}
        </Badge>
      ),
    },
    {
      id: 'reported',
      header: 'Reported',
      accessorFn: (c) => Date.parse(c.reportedAt),
      cell: ({ row }) => <RelativeTime at={row.original.reportedAt} now={now} />,
    },
  ];
}

/**
 * Equipment claims (SA-01, T&C §8.2): damage to a photographer's gear caused by the client,
 * guests or an unsafe venue, with evidence, up to ₹2,00,000 per incident. Approval sends the
 * payment to finance's "To settle".
 */
export function ClaimsDesk() {
  const [filter, setFilter] = useState<AdminClaimFilter>('OPEN');
  const [open, setOpen] = useState<AdminClaimItem | null>(null);
  const [logging, setLogging] = useState(false);
  const now = useNow();
  const canWork = useCan(CARE_ACTION_ROLES.workClaims)();
  const list = usePagedList(claimKeys.list(filter), (cursor) =>
    adminApi.care.claims.list({ cursor, status: filter }),
  );
  const cols = useMemo(() => columns(now), [now]);

  return (
    <>
      <PageHeader
        eyebrow="Customer care"
        title="Equipment claims"
        description="Gear damaged on a shoot. Gather the evidence, then approve up to ₹2,00,000 per incident or reject with a reason."
        actions={
          <>
            <Button variant="outline" onClick={list.retry} disabled={list.isRefreshing}>
              <RefreshCwIcon />
              Refresh
            </Button>
            {canWork ? (
              <Button onClick={() => setLogging(true)}>
                <PlusIcon />
                Log a claim
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(AdminClaimFilter.parse(v))}
        className="mb-4"
      >
        <TabsList aria-label="Which claims">
          {AdminClaimFilter.options.map((f) => (
            <TabsTrigger key={f} value={f}>
              {FILTER_LABEL[f]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        key={filter}
        caption={`${FILTER_LABEL[filter]} equipment claims`}
        columns={cols}
        data={list.rows}
        getRowId={(c) => c.id}
        onRowClick={setOpen}
        rowLabel={(c) => `Open the claim on ${c.bookingReference}`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={filter === 'OPEN' ? 'All caught up' : 'Nothing here yet'}
        emptyDescription={
          filter === 'OPEN' ? 'No claim is waiting for a decision.' : 'Decided claims show up here.'
        }
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
      {open ? <ClaimSheet key={open.id} claim={open} onClose={() => setOpen(null)} /> : null}
      {logging ? (
        <NewClaimSheet
          onClose={() => setLogging(false)}
          onCreated={(claim) => {
            setLogging(false);
            setOpen(claim);
          }}
        />
      ) : null}
    </>
  );
}
