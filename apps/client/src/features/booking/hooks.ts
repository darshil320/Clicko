import { isApiError } from '@clickco/api-client';
import type { QuoteRequestBody } from '@clickco/contracts';
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { bookingKeys } from '@/shared/bookings-query';
import { BOOKABLE_TIERS } from '@/shared/catalogue';
import { TERMS_VERSION } from '@/shared/config';
import { createBooking, fetchQuote, openPayment, simulatePayment } from './api';
import { type Booker, createBookingBody, referenceRequest } from './lib/draft';
import { fingerprint } from './lib/keys';
import { referenceSlot } from './lib/schedule';
import { useBookingDraft } from './store';

const QUOTE_STALE_MS = 60_000;
const REFERENCE_STALE_MS = 5 * 60_000;

const quoteKey = (body: QuoteRequestBody) => ['quote', body] as const;

/** A live quote. Keeps showing the previous price while the next one loads (no flicker). */
export function useQuote(body: QuoteRequestBody | null) {
  return useQuery({
    queryKey: ['quote', body],
    queryFn: () => fetchQuote(body as QuoteRequestBody),
    enabled: body !== null,
    staleTime: QUOTE_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/** Home's "from ₹X / 2 hrs" — one reference quote per bookable tier, for the client's pincode. */
export function useTierPrices(pincode: string) {
  const slot = useMemo(() => referenceSlot(new Date()), []);
  const results = useQueries({
    queries: BOOKABLE_TIERS.map((tier) => {
      const body = referenceRequest(tier, pincode, slot);
      return {
        queryKey: quoteKey(body),
        queryFn: () => fetchQuote(body),
        staleTime: REFERENCE_STALE_MS,
      };
    }),
  });
  return BOOKABLE_TIERS.map((tier, i) => ({ tier, query: results[i] }));
}

/** The reference quote for one tier (plan detail shows the same number Home did). */
export function useReferenceQuote(tier: (typeof BOOKABLE_TIERS)[number] | null, pincode: string) {
  const slot = useMemo(() => referenceSlot(new Date()), []);
  return useQuote(tier ? referenceRequest(tier, pincode, slot) : null);
}

export interface CheckoutInput {
  readonly booker: Booker;
  readonly modelReleaseConsent: boolean;
}

/**
 * Review → Pay: POST /bookings (once per exact request) then POST /bookings/:id/pay.
 * Both carry Idempotency-Keys held in the persisted draft store, so a double tap, a retry
 * after a timeout or an app restart replays the same booking instead of making another.
 */
export function useCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ booker, modelReleaseConsent }: CheckoutInput) => {
      const store = useBookingDraft.getState();
      if (!store.draft) throw new Error('There is no booking in progress');
      const body = createBookingBody(store.draft, booker, {
        modelReleaseConsent,
        termsVersion: TERMS_VERSION,
      });
      const print = fingerprint(body);

      let bookingId = store.created?.fingerprint === print ? store.created.bookingId : null;
      if (bookingId === null) {
        const created = await createBooking(body, store.claimKey('create', print));
        bookingId = created.booking.id;
        useBookingDraft.getState().bookingCreated({ bookingId, fingerprint: print });
      }

      try {
        const payment = await openPayment(
          bookingId,
          useBookingDraft.getState().claimKey(`pay:${bookingId}`, bookingId),
        );
        useBookingDraft.getState().paymentOpened({ bookingId, payment });
        return { bookingId, payment };
      } catch (error) {
        // An expired quote cannot be paid: the next tap must create a fresh booking + key.
        if (isApiError(error) && error.code === 'QUOTE_EXPIRED') {
          useBookingDraft.getState().forgetCreated();
        }
        throw error;
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}

/** Re-opens the advance payment for an existing booking (resume from the booking screen). */
export function useOpenPayment(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const key = useBookingDraft.getState().claimKey(`pay:${bookingId}`, bookingId);
      const payment = await openPayment(bookingId, key);
      useBookingDraft.getState().paymentOpened({ bookingId, payment });
      return payment;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookingKeys.all }),
  });
}

/** Development only: drive the sandbox webhook, then refresh the booking. */
export function useSimulatePayment(bookingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentId: string) => simulatePayment(paymentId, 'CAPTURED'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bookingKeys.detail(bookingId) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: bookingKeys.list() }),
  });
}
