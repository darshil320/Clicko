import { newIdempotencyKey } from '@clickco/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { bookingKeys, useBookingDetail, useBookingList } from '@/shared/bookings-query';
import { cancelBooking, fetchBookingMoney } from './api';

export const useBookings = useBookingList;

/** The booking's refunds and credits. Under bookingKeys.all, so a cancel refreshes it too. */
export function useBookingMoney(bookingId: string) {
  return useQuery({
    queryKey: bookingKeys.money(bookingId),
    queryFn: () => fetchBookingMoney(bookingId),
  });
}

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
