import { isApiError } from '@clickco/api-client';
import { QueryClient } from '@tanstack/react-query';

const MAX_RETRIES = 2;
const STALE_MS = 30_000;

/** A 4xx will fail the same way again; network blips and 5xx get two quiet retries. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isApiError(error) && error.isClientError) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry, staleTime: STALE_MS, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
