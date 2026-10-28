import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  type BoardFilters,
  EMPTY_FILTERS,
  filtersFromSearch,
  filtersToQuery,
  filtersToSearch,
  toggleStatus,
} from './booking-filters';

const SURAT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('booking board filters', () => {
  it('round-trips through the URL', () => {
    const filters: BoardFilters = {
      statuses: ['DISPATCHING', 'QA'],
      cityId: SURAT,
      from: '2026-11-01',
      to: '2026-11-30',
      search: 'CLK-48',
      needsAttention: true,
    };
    const search = filtersToSearch(filters);
    expect(filtersFromSearch(new URLSearchParams(search))).toEqual(filters);
    expect(filtersToSearch(EMPTY_FILTERS)).toBe('');
  });

  it('drops anything malformed in the URL', () => {
    const parsed = filtersFromSearch(
      new URLSearchParams(
        'status=QA&status=NOPE&status=QA&city=surat&from=2026-13-45&to=yesterday&attention=yes',
      ),
    );
    expect(parsed).toEqual({ ...EMPTY_FILTERS, statuses: ['QA'] });
  });

  it('maps to the API query, leaving out what is unset', () => {
    expect(filtersToQuery(EMPTY_FILTERS)).toEqual({});
    expect(
      filtersToQuery(
        { ...EMPTY_FILTERS, statuses: ['QA'], needsAttention: true, search: ' Rahul ' },
        'cursor-2',
      ),
    ).toEqual({ status: ['QA'], needsAttention: true, q: 'Rahul', cursor: 'cursor-2' });
  });

  it('ignores a one-letter search and swaps a reversed date range', () => {
    const query = filtersToQuery({
      ...EMPTY_FILTERS,
      search: 'R',
      from: '2026-11-30',
      to: '2026-11-01',
    });
    expect(query).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('counts active filters and toggles statuses', () => {
    const one = toggleStatus(EMPTY_FILTERS, 'QA');
    expect(one.statuses).toEqual(['QA']);
    expect(toggleStatus(one, 'QA').statuses).toEqual([]);
    expect(EMPTY_FILTERS.statuses).toEqual([]);
    expect(activeFilterCount({ ...one, from: '2026-11-01', search: 'x' })).toBe(2);
  });
});
