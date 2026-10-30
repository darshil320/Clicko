'use client';

import { type AdminPhotographerRow, PhotographerStatus } from '@clickco/contracts';
import {
  Badge,
  type ColumnDef,
  DataTable,
  Input,
  SearchIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@clickco/ui-web';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { adminApi } from '../../shared/api';
import { Muted } from '../../shared/cells';
import { formatCode, formatPhone } from '../../shared/format';
import { usePagedList } from '../../shared/paged';
import { PRO_STATUS, supplyKeys } from './labels';

const ALL = 'ALL';

const COLUMNS: ReadonlyArray<ColumnDef<AdminPhotographerRow>> = [
  {
    id: 'name',
    header: 'Photographer',
    accessorFn: (p) => p.fullName,
    cell: ({ row }) => (
      <div className="grid">
        <span className="font-semibold">{row.original.fullName}</span>
        <Muted>{formatPhone(row.original.phone)}</Muted>
      </div>
    ),
  },
  { id: 'city', header: 'City', accessorFn: (p) => p.cityName },
  {
    id: 'tier',
    header: 'Up to',
    accessorFn: (p) => p.maxTier,
    cell: ({ row }) => formatCode(row.original.maxTier),
  },
  {
    id: 'rating',
    header: 'Rating · shoots',
    accessorFn: (p) => p.ratingAvgBps ?? 0,
    cell: ({ row }) => (
      <span>
        {row.original.ratingAvgBps === null
          ? '—'
          : `★ ${(row.original.ratingAvgBps / 1000).toFixed(2)}`}
        <Muted> · {row.original.shootsCompleted}</Muted>
      </span>
    ),
  },
  {
    id: 'penalties',
    header: 'Penalties',
    accessorFn: (p) => p.activePenalties,
    cell: ({ row }) =>
      row.original.activePenalties > 0 ? (
        <Badge variant="warning">{row.original.activePenalties} active</Badge>
      ) : (
        <Muted>None</Muted>
      ),
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (p) => p.status,
    cell: ({ row }) => (
      <Badge variant={PRO_STATUS[row.original.status].tone}>
        {PRO_STATUS[row.original.status].label}
      </Badge>
    ),
  },
];

/** Everyone on file, alphabetically: search by name or phone, filter by status. */
export function Directory() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>(ALL);
  const q = search.trim().length >= 2 ? search.trim() : undefined;
  const parsedStatus = status === ALL ? undefined : PhotographerStatus.parse(status);
  const list = usePagedList(supplyKeys.directory({ q, status }), (cursor) =>
    adminApi.supply.photographers.list({
      cursor,
      ...(q ? { q } : {}),
      ...(parsedStatus ? { status: parsedStatus } : {}),
    }),
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search photographers by name or phone"
            placeholder="Search by name or phone"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Status" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Every status</SelectItem>
            {PhotographerStatus.options.map((s) => (
              <SelectItem key={s} value={s}>
                {PRO_STATUS[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DataTable
        caption="Photographers"
        columns={COLUMNS}
        data={list.rows}
        getRowId={(p) => p.id}
        onRowClick={(p) => router.push(`/photographers/${p.id}`)}
        rowLabel={(p) => `Open ${p.fullName}'s profile`}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle={q ? 'No one matches that search' : 'No photographers yet'}
        emptyDescription="Photographers appear here once they apply."
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
    </div>
  );
}
