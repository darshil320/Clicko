import type { BookingStatus, CancelBookingBody } from '@clickco/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isFinished } from '@/shared/booking-status';
import { bookingKeys, useBookingDetail, useBookingList } from '@/shared/bookings-query';
import { fingerprint } from '@/shared/idempotency';
import { cancelBooking, fetchBookingMoney, fetchCancellationQuote } from './api';
import { cancelFailure } from './lib/cancellation';
import { useBookingKeys } from './store';

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
 * GET /bookings/:id/cancellation for a booking still ahead. Keyed by status too, so a move (a
 * photographer accepts, the shoot starts) asks again; under bookingKeys.all, so a cancel does.
 */
export function useCancellationQuote(bookingId: string, status: BookingStatus) {
  return useQuery({
    queryKey: [...bookingKeys.all, 'cancellation', bookingId, status] as const,
    queryFn: () => fetchCancellationQuote(bookingId),
    enabled: !isFinished(status),
  });
}

const cancelScope = (bookingId: string) => `cancel:${bookingId}`;

/**
 * POST /bookings/:id/cancel with the refund the client confirmed from the quote. One key per exact
 * request (the persisted booking key ring): a double tap, a timeout or a restart replays the first
 * answer; confirming a new figure is a new request. Every answer refreshes the booking, its
 * "Refunds & credits" and the quote.
 */
export function useCancelBooking(bookingId: string) {
  const queryClient = useQueryClient();
  const scope = cancelScope(bookingId);
  return useMutation({
    mutationFn: (body: CancelBookingBody) =>
      cancelBooking(bookingId, body, useBookingKeys.getState().claimKey(scope, fingerprint(body))),
    onSuccess: () => useBookingKeys.getState().release(scope),
    onError: (error) => {
      // A refusal that retrying cannot change frees the scope for the next intent.
      if (cancelFailure(error).next !== 'retry') useBookingKeys.getState().release(scope);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}
