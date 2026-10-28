'use client';

import type { AdminBookingQuery, AdminBreachStatusFilter } from '@clickco/contracts';
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { describeError, isRetryable } from './errors';
import { signOut } from './sign-out';

/** Query keys, in one place so a mutation can invalidate exactly what it changed. */
export const keys = {
  me: ['me'] as const,
  cities: ['cities'] as const,
  bookings: (query: AdminBookingQuery) => ['bookings', query] as const,
  bookingsAll: ['bookings'] as const,
  booking: (id: string) => ['booking', id] as const,
  bookingAll: ['booking'] as const,
  qa: ['qa'] as const,
  incidents: ['incidents'] as const,
  dispatch: ['dispatch'] as const,
  dispatchDetail: (id: string) => ['dispatch', id] as const,
  breaches: (status: AdminBreachStatusFilter) => ['breaches', status] as const,
  breachesAll: ['breaches'] as const,
  alerts: ['alerts'] as const,
  staff: ['staff'] as const,
};

const STALE_MS = 15_000;
const MAX_RETRIES = 2;

/** A 401 anywhere (after the SDK's one refresh) ends the session. */
function onError(error: unknown): void {
  if (describeError(error).signIn) void signOut('expired');
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: STALE_MS,
        retry: (count, error) => count < MAX_RETRIES && isRetryable(error),
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}
