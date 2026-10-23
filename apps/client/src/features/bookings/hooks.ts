import { newIdempotencyKey } from '@clickco/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { bookingKeys, useBookingDetail, useBookingList } from '@/shared/bookings-query';
import { cancelBooking } from './api';

export const useBookings = useBookingList;

/** Detail, polled while the booking is moving through dispatch/shoot/delivery. */
export function useBooking(bookingId: string | undefined, pollMs?: number) {
  return useBookingDetail(bookingId, pollMs ? { pollMs } : {});
}

/**
 * Cancel before payment. One key per cancel intent: retries after a failure reuse it, so
 * the API replays the same outcome instead of acting twice.
 */
export function useCancelBooking(bookingId: string) {
  const queryClient = useQueryClient();
  const key = useRef<string | null>(null);
  return useMutation({
    mutationFn: () => {
      key.current ??= newIdempotencyKey();
      return cancelBooking(bookingId, key.current);
    },
    onSuccess: () => {
      key.current = null;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}
