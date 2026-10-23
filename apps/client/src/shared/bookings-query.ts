import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { isFinished } from './booking-status';

/**
 * Booking server state shared by two features: `booking` (checkout → payment) and
 * `bookings` (list, detail, confirmed). One cache, one set of keys.
 */
export const bookingKeys = {
  all: ['bookings'] as const,
  list: () => [...bookingKeys.all, 'list'] as const,
  detail: (id: string) => [...bookingKeys.all, 'detail', id] as const,
};

export function useBookingList() {
  return useQuery({ queryKey: bookingKeys.list(), queryFn: () => api.bookings.list() });
}

/** With `pollMs`, refetches while the booking is still live and stops once it has finished. */
export function useBookingDetail(bookingId: string | undefined, options: { pollMs?: number } = {}) {
  const { pollMs } = options;
  return useQuery({
    queryKey: bookingKeys.detail(bookingId ?? ''),
    queryFn: () => api.bookings.get(bookingId as string),
    enabled: bookingId !== undefined && bookingId !== '',
    refetchInterval: (query) => {
      const status = query.state.data?.booking.status;
      return pollMs && status && !isFinished(status) ? pollMs : false;
    },
  });
}
