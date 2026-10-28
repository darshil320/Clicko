import { type AdminBookingQuery, BookingStatus, Uuid } from '@clickco/contracts';

/**
 * The booking board's filters (ADR-0025 D5): status (several), city, an IST date range, a
 * search and "needs attention". They live in the URL so a filtered board can be linked and the
 * back button works; this module maps URL ⇄ filters ⇄ API query.
 */
export interface BoardFilters {
  readonly statuses: ReadonlyArray<BookingStatus>;
  readonly cityId: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly search: string;
  readonly needsAttention: boolean;
}

export const EMPTY_FILTERS: BoardFilters = {
  statuses: [],
  cityId: null,
  from: null,
  to: null,
  search: '',
  needsAttention: false,
};

/** The API searches from two characters (reference, phone or name). */
export const MIN_SEARCH = 2;
export const MAX_SEARCH = 80;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: string | null): value is string {
  return value !== null && ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Reads filters from the URL, dropping anything malformed (the URL is user input). */
export function filtersFromSearch(params: URLSearchParams): BoardFilters {
  const statuses = [
    ...new Set(
      params.getAll('status').flatMap((s) => {
        const parsed = BookingStatus.safeParse(s);
        return parsed.success ? [parsed.data] : [];
      }),
    ),
  ];
  const city = params.get('city');
  const from = params.get('from');
  const to = params.get('to');
  return {
    statuses,
    cityId: city !== null && Uuid.safeParse(city).success ? city : null,
    from: isDay(from) ? from : null,
    to: isDay(to) ? to : null,
    search: (params.get('q') ?? '').slice(0, MAX_SEARCH),
    needsAttention: params.get('attention') === '1',
  };
}

/** Writes filters to a query string; empty filters write nothing. */
export function filtersToSearch(filters: BoardFilters): string {
  const params = new URLSearchParams();
  for (const s of filters.statuses) params.append('status', s);
  if (filters.cityId) params.set('city', filters.cityId);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  const search = filters.search.trim();
  if (search) params.set('q', search);
  if (filters.needsAttention) params.set('attention', '1');
  return params.toString();
}

/** The API query for one page. A reversed date range is swapped; a one-letter search is ignored. */
export function filtersToQuery(filters: BoardFilters, cursor?: string): AdminBookingQuery {
  const [from, to] =
    filters.from && filters.to && filters.from > filters.to
      ? [filters.to, filters.from]
      : [filters.from, filters.to];
  const search = filters.search.trim();
  return {
    ...(filters.statuses.length > 0 ? { status: [...filters.statuses] } : {}),
    ...(filters.cityId ? { cityId: filters.cityId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(search.length >= MIN_SEARCH ? { q: search.slice(0, MAX_SEARCH) } : {}),
    ...(filters.needsAttention ? { needsAttention: true } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function activeFilterCount(filters: BoardFilters): number {
  return (
    (filters.statuses.length > 0 ? 1 : 0) +
    (filters.cityId ? 1 : 0) +
    (filters.from || filters.to ? 1 : 0) +
    (filters.search.trim().length >= MIN_SEARCH ? 1 : 0) +
    (filters.needsAttention ? 1 : 0)
  );
}

/** Adds or removes one status (the multi-select). */
export function toggleStatus(filters: BoardFilters, status: BookingStatus): BoardFilters {
  const has = filters.statuses.includes(status);
  return {
    ...filters,
    statuses: has ? filters.statuses.filter((s) => s !== status) : [...filters.statuses, status],
  };
}
