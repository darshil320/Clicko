import { useQuery } from '@tanstack/react-query';
import { fetchEarnings } from './api';

export const earningsKeys = { all: ['earnings'] as const };

/**
 * One query for the Earnings tab and the Jobs tab's header line. The root layout invalidates
 * every query after an on-site action reaches the server, so a check-out shows up here.
 */
export function useEarnings() {
  return useQuery({ queryKey: earningsKeys.all, queryFn: fetchEarnings });
}
