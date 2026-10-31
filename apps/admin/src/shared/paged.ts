'use client';

import { type QueryKey, useInfiniteQuery } from '@tanstack/react-query';
import { describeError } from './errors';

/** Pages kept in the cache (and refetched) per list. */
const MAX_PAGES = 3;

interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

/**
 * A keyset-paged admin list (ADR-0025 D5): the first page loads, "Load more" appends the next
 * one with the API's opaque cursor. Rows, loading and error states for the DataTable.
 */
export function usePagedList<T>(
  queryKey: QueryKey,
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: { readonly enabled?: boolean; readonly refetchInterval?: number } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Keep at most 3 pages cached: a refetch (and every refetchInterval) re-requests each cached
    // page in turn, so a long "Load more" session would otherwise grow every poll without bound.
    maxPages: MAX_PAGES,
    enabled: options.enabled ?? true,
    ...(options.refetchInterval ? { refetchInterval: options.refetchInterval } : {}),
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  return {
    rows,
    isLoading: query.isPending && (options.enabled ?? true),
    error: query.isError ? describeError(query.error).message : null,
    retry: () => void query.refetch(),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
  };
}
