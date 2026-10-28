import { newIdempotencyKey } from '@clickco/api-client';
import type { ProOffer } from '@clickco/contracts';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useCallback, useState } from 'react';
import { acceptOffer, declineOffer, listOffers } from './api';

/** No push for new offers until S11, so the feed polls (ADR-0024 D3). */
export const OFFER_POLL_MS = 10_000;

export const offerKeys = {
  all: ['offers'] as const,
  list: () => [...offerKeys.all, 'list'] as const,
};

/**
 * Polls every 10 s while the screen showing it is focused and the app is in the foreground
 * (the root layout feeds AppState into TanStack's focusManager). Never in the background.
 */
function useOffersQuery<T>(select: (offers: ProOffer[]) => T) {
  const focused = useIsFocused();
  return useQuery({
    queryKey: offerKeys.list(),
    queryFn: listOffers,
    select,
    refetchInterval: focused ? OFFER_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

const all = (offers: ProOffer[]): readonly ProOffer[] => offers;

export function useOffers() {
  return useOffersQuery(all);
}

/** There is no single-offer GET: one offer is read from the polled list (null once it has gone). */
export function useOffer(attemptId: string) {
  const select = useCallback(
    (offers: ProOffer[]) => offers.find((offer) => offer.attemptId === attemptId) ?? null,
    [attemptId],
  );
  return useOffersQuery(select);
}

/** Drop an answered offer from the feed at once; the refetch confirms it. */
function forget(queryClient: QueryClient, attemptId: string): void {
  queryClient.setQueryData<ProOffer[]>(offerKeys.list(), (offers) =>
    offers?.filter((offer) => offer.attemptId !== attemptId),
  );
}

/**
 * Accept with one Idempotency-Key per offer intent: a retry after any failure reuses it (the API
 * releases a key whose request failed), so a lost response can never become a second accept.
 * Mount once per offer (the detail screen is keyed by attemptId).
 */
export function useAcceptOffer(onAccepted: (assignmentId: string) => void) {
  const queryClient = useQueryClient();
  const [idempotencyKey] = useState(newIdempotencyKey);
  return useMutation({
    mutationFn: (offer: ProOffer) => acceptOffer(offer.attemptId, idempotencyKey),
    onSuccess: (accepted) => {
      onAccepted(accepted.assignmentId);
      forget(queryClient, accepted.attemptId);
      // The new assignment, today's jobs and earnings all change: refresh everything.
      void queryClient.invalidateQueries();
    },
    // Lost the race or the window closed: the refetch removes the offer.
    onError: () => void queryClient.invalidateQueries({ queryKey: offerKeys.all }),
  });
}

export interface DeclineInput {
  readonly offer: ProOffer;
  readonly reason: string | null;
}

export function useDeclineOffer(onDeclined: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ offer, reason }: DeclineInput) => declineOffer(offer.attemptId, reason),
    onSuccess: (declined) => {
      onDeclined();
      forget(queryClient, declined.attemptId);
      void queryClient.invalidateQueries({ queryKey: offerKeys.all });
    },
    onError: () => void queryClient.invalidateQueries({ queryKey: offerKeys.all }),
  });
}
