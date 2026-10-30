'use client';

import type { AdminNeedsYou, AdminOverview, StaffGrant } from '@clickco/contracts';
import { useQuery } from '@tanstack/react-query';
import { canUse, type Desk } from './access';
import { adminApi } from './api';
import { keys } from './query';

/** Today's numbers and the nav's counts refresh every minute while the tab is visible. */
export const OVERVIEW_REFRESH_MS = 60_000;

type Grants = ReadonlyArray<Pick<StaffGrant, 'role' | 'cityId' | 'cityName'>>;

/**
 * GET /admin/overview (ADR-0026 D8), shared by the Today page and the navigation's live counts:
 * one request, one cache entry. TanStack Query pauses the interval while the tab is hidden and
 * refetches when it comes back into focus.
 */
export function useOverview(grants: Grants | null) {
  return useQuery({
    queryKey: keys.overview,
    queryFn: () => adminApi.overview.get(),
    enabled: grants !== null && canUse(grants, 'overview'),
    refetchInterval: OVERVIEW_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: OVERVIEW_REFRESH_MS / 2,
  });
}

/** The live count per desk for the navigation: one "Needs you" entry per desk with work. */
export function countsByDesk(
  overview: AdminOverview | undefined,
): ReadonlyMap<Desk, AdminNeedsYou> {
  return new Map((overview?.needsYou ?? []).map((n) => [n.desk, n] as const));
}
