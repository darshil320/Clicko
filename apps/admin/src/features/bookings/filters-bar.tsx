'use client';

import {
  Button,
  CheckIcon,
  Input,
  Label,
  SearchIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  XIcon,
} from '@clickco/ui-web';
import { useEffect, useState } from 'react';
import type { CityRef } from '../../shared/access';
import {
  activeFilterCount,
  type BoardFilters,
  EMPTY_FILTERS,
  MAX_SEARCH,
  toggleStatus,
} from '../../shared/booking-filters';
import { StatusFilter } from './status-filter';

const ALL_CITIES = 'all';
const SEARCH_DEBOUNCE_MS = 300;

/** Filters for the booking board (ADR-0025 D5). Changes go to the URL; the board reloads. */
export function FiltersBar({
  filters,
  cities,
  onChange,
}: {
  readonly filters: BoardFilters;
  readonly cities: ReadonlyArray<CityRef>;
  readonly onChange: (next: BoardFilters) => void;
}) {
  const [search, setSearch] = useState(filters.search);

  // The URL is the source of truth (back button, shared links); follow it.
  useEffect(() => setSearch(filters.search), [filters.search]);

  useEffect(() => {
    if (search === filters.search) return;
    const timer = window.setTimeout(() => onChange({ ...filters, search }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search, filters, onChange]);

  const active = activeFilterCount(filters);

  return (
    <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-60 flex-1 gap-2">
          <Label htmlFor="board-search">Search</Label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
            />
            <Input
              id="board-search"
              type="search"
              placeholder="Reference, phone or client name"
              maxLength={MAX_SEARCH}
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <span className="font-medium text-sm leading-none">Status</span>
          <StatusFilter
            selected={filters.statuses}
            onToggle={(status) => onChange(toggleStatus(filters, status))}
            onClear={() => onChange({ ...filters, statuses: [] })}
          />
        </div>
        <div className="grid w-44 gap-2">
          <Label htmlFor="board-city">City</Label>
          <Select
            value={filters.cityId ?? ALL_CITIES}
            onValueChange={(value) =>
              onChange({ ...filters, cityId: value === ALL_CITIES ? null : value })
            }
          >
            <SelectTrigger id="board-city">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CITIES}>All cities</SelectItem>
              {cities.map((city) => (
                <SelectItem key={city.cityId} value={city.cityId}>
                  {city.cityName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="board-from">Shoot from</Label>
          <Input
            id="board-from"
            type="date"
            className="w-40"
            value={filters.from ?? ''}
            onChange={(e) => onChange({ ...filters, from: e.target.value || null })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="board-to">Shoot to</Label>
          <Input
            id="board-to"
            type="date"
            className="w-40"
            value={filters.to ?? ''}
            onChange={(e) => onChange({ ...filters, to: e.target.value || null })}
          />
        </div>
        <Button
          variant={filters.needsAttention ? 'secondary' : 'outline'}
          aria-pressed={filters.needsAttention}
          onClick={() => onChange({ ...filters, needsAttention: !filters.needsAttention })}
        >
          {filters.needsAttention ? <CheckIcon /> : null}
          Needs attention
        </Button>
        {active > 0 ? (
          <Button variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            <XIcon />
            Clear filters
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-sm">
        Dates are India calendar days on the shoot’s start. Search needs at least two characters.
      </p>
    </div>
  );
}
