import type { ClientQualityIssueBody, ClientTicketBody } from '@clickco/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bookingKeys, useBookingList } from '@/shared/bookings-query';
import { fingerprint } from '@/shared/idempotency';
import { fetchTickets, raiseTicket, reportQualityIssue } from './api';
import { isAlreadyReported } from './lib/quality';
import { useCareKeys } from './store';

export const careKeys = {
  tickets: ['care', 'tickets'] as const,
};

const TICKET_SCOPE = 'ticket';
const qualityScope = (bookingId: string) => `quality:${bookingId}`;

export function useTickets() {
  return useQuery({ queryKey: careKeys.tickets, queryFn: fetchTickets });
}

/** The client's bookings, for "which booking is this about?" (the shared booking cache). */
export const useBookingsForTicket = useBookingList;

/**
 * POST /me/tickets with one Idempotency-Key per exact request (the care key ring, persisted like
 * checkout's): a double tap, a retry after a timeout or an app restart replays the first answer.
 */
export function useRaiseTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ClientTicketBody) =>
      raiseTicket(body, useCareKeys.getState().claimKey(TICKET_SCOPE, fingerprint(body))),
    onSuccess: () => useCareKeys.getState().release(TICKET_SCOPE),
    onSettled: () => queryClient.invalidateQueries({ queryKey: careKeys.tickets }),
  });
}

/**
 * POST /bookings/:id/quality-issue, keyed the same way per booking. The booking moves to
 * "Under review", so the booking cache is refreshed — also when the server says one is already
 * open, which the screen then shows instead of an error.
 */
export function useReportQualityIssue(bookingId: string) {
  const queryClient = useQueryClient();
  const scope = qualityScope(bookingId);
  return useMutation({
    mutationFn: (body: ClientQualityIssueBody) =>
      reportQualityIssue(
        bookingId,
        body,
        useCareKeys.getState().claimKey(scope, fingerprint(body)),
      ),
    onSuccess: () => {
      useCareKeys.getState().release(scope);
      void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
    },
    onError: (error) => {
      if (isAlreadyReported(error))
        void queryClient.invalidateQueries({ queryKey: bookingKeys.all });
    },
  });
}
