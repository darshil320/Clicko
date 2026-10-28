'use client';

import { Button, DataTable, PageHeader, RefreshCwIcon } from '@clickco/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import { adminApi } from '../../shared/api';
import {
  type BoardFilters,
  filtersFromSearch,
  filtersToQuery,
  filtersToSearch,
} from '../../shared/booking-filters';
import { useCities } from '../../shared/cities';
import { usePagedList } from '../../shared/paged';
import { keys } from '../../shared/query';
import { useNow } from '../../shared/use-now';
import { bookingColumns } from './columns';
import { FiltersBar } from './filters-bar';

/** The booking board (ADR-0025 D5): filters, keyset "Load more", a row opens the booking. */
export function BookingsBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const client = useQueryClient();
  const now = useNow();

  const filters = useMemo(
    () => filtersFromSearch(new URLSearchParams(params.toString())),
    [params],
  );
  const query = useMemo(() => filtersToQuery(filters), [filters]);
  const list = usePagedList(keys.bookings(query), (cursor) =>
    adminApi.bookings.list(filtersToQuery(filters, cursor)),
  );

  const setFilters = useCallback(
    (next: BoardFilters) => {
      const search = filtersToSearch(next);
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const cities = useCities();
  const columns = useMemo(() => bookingColumns(now), [now]);

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Every booking in your cities, newest shoots first. Open one for its full history."
        actions={
          <Button
            variant="outline"
            onClick={() => client.invalidateQueries({ queryKey: keys.bookingsAll })}
            disabled={list.isRefreshing}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        }
      />
      <FiltersBar filters={filters} cities={cities} onChange={setFilters} />
      <DataTable
        caption="Bookings"
        columns={columns}
        data={list.rows}
        getRowId={(row) => row.id}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={list.retry}
        emptyTitle="No bookings match"
        emptyDescription="Try fewer filters or a wider date range."
        emptyAction={
          <Button
            variant="outline"
            onClick={() => setFilters(filtersFromSearch(new URLSearchParams()))}
          >
            Clear filters
          </Button>
        }
        onRowClick={(row) => router.push(`/bookings/${row.id}`)}
        rowLabel={(row) => `Open booking ${row.reference}`}
        hasMore={list.hasMore}
        isLoadingMore={list.isLoadingMore}
        onLoadMore={list.loadMore}
      />
    </>
  );
}
