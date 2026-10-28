'use client';

import { useQuery } from '@tanstack/react-query';
import type { CityRef } from './access';
import { adminApi } from './api';
import { keys } from './query';

/** Cities change rarely; one fetch per session is plenty. */
const CITIES_STALE_MS = 30 * 60_000;

/** The cities the caller may work in, from GET /admin/cities (server-filtered, ADR-0025 D3). */
export function useCities(): ReadonlyArray<CityRef> {
  const query = useQuery({
    queryKey: keys.cities,
    queryFn: () => adminApi.cities(),
    staleTime: CITIES_STALE_MS,
  });
  return (query.data ?? []).map((c) => ({ cityId: c.id, cityName: c.name }));
}
