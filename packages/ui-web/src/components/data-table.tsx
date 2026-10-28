'use client';

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Header,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, InboxIcon } from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Alert, AlertDescription, AlertTitle } from './alert.js';
import { Button } from './button.js';
import { EmptyState } from './empty-state.js';
import { Skeleton } from './skeleton.js';
import { Spinner } from './spinner.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table.js';

const SKELETON_ROWS = 6;

/**
 * A table over rows already fetched. Sorting is client-side over the loaded rows; paging is the
 * API's keyset cursor, so "Load more" appends the next page (there is no page count to jump to).
 */
export interface DataTableProps<TData> {
  readonly columns: ReadonlyArray<ColumnDef<TData>>;
  readonly data: ReadonlyArray<TData>;
  readonly getRowId: (row: TData) => string;
  readonly isLoading?: boolean;
  /** The error to show instead of rows (the server's message). */
  readonly error?: string | null;
  readonly onRetry?: () => void;
  readonly emptyTitle?: React.ReactNode;
  readonly emptyDescription?: React.ReactNode;
  readonly emptyAction?: React.ReactNode;
  /** Opens a row: on click, or Enter when the row has focus. */
  readonly onRowClick?: (row: TData) => void;
  readonly rowLabel?: (row: TData) => string;
  readonly hasMore?: boolean;
  readonly isLoadingMore?: boolean;
  readonly onLoadMore?: () => void;
  readonly initialSorting?: SortingState;
  readonly caption?: string;
  readonly className?: string;
}

function SortButton<TData>({ header }: { readonly header: Header<TData, unknown> }) {
  const sorted = header.column.getIsSorted();
  const label = flexRender(header.column.columnDef.header, header.getContext());
  return (
    <button
      type="button"
      onClick={header.column.getToggleSortingHandler()}
      className="-ml-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 uppercase tracking-micro outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {label}
      {sorted === 'asc' ? (
        <ArrowUpIcon className="size-3" aria-hidden="true" />
      ) : sorted === 'desc' ? (
        <ArrowDownIcon className="size-3" aria-hidden="true" />
      ) : (
        <ArrowUpDownIcon className="size-3 opacity-50" aria-hidden="true" />
      )}
    </button>
  );
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

function DataTable<TData>({
  columns,
  data,
  getRowId,
  isLoading = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing here',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowLabel,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  initialSorting = [],
  caption,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const table = useReactTable({
    data: data as TData[],
    columns: columns as ColumnDef<TData>[],
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const columnCount = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  return (
    <div data-slot="data-table" className={cn('grid gap-3', className)}>
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <Table aria-busy={isLoading || isLoadingMore}>
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} className="hover:bg-transparent">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} aria-sort={sorted ? ARIA_SORT[sorted] : undefined}>
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <SortButton header={header} />
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="whitespace-normal p-4">
                  <Alert variant="destructive">
                    <AlertTitle>Could not load this list</AlertTitle>
                    <AlertDescription>
                      <p>{error}</p>
                      {onRetry ? (
                        <Button variant="outline" size="sm" onClick={onRetry}>
                          Try again
                        </Button>
                      ) : null}
                    </AlertDescription>
                  </Alert>
                </TableCell>
              </TableRow>
            ) : isLoading ? (
              Array.from({ length: SKELETON_ROWS }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
                <TableRow key={i} className="hover:bg-transparent">
                  {Array.from({ length: columnCount }, (_, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: placeholder cells have no identity
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columnCount} className="whitespace-normal">
                  <EmptyState
                    icon={<InboxIcon />}
                    title={emptyTitle}
                    description={emptyDescription}
                    action={emptyAction}
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick && rowLabel ? rowLabel(row.original) : undefined}
                  className={cn(
                    onRowClick &&
                      'cursor-pointer outline-none focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') onRowClick(row.original);
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!error && !isLoading && (hasMore || rows.length > 0) ? (
        <div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
          <span>
            {rows.length} {rows.length === 1 ? 'row' : 'rows'} loaded
          </span>
          {hasMore && onLoadMore ? (
            <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoadingMore}>
              {isLoadingMore ? <Spinner /> : null}
              {isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type { ColumnDef, SortingState };
export { DataTable };
