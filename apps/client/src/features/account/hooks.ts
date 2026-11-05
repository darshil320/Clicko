import type { ConfirmAccountDeletionBody } from '@clickco/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBookingList } from '@/shared/bookings-query';
import { fingerprint } from '@/shared/idempotency';
import { eraseThisDevice } from '@/shared/session/store';
import { confirmDeletion, fetchDeletionPreview, requestDeletion } from './api';
import { deletionFailure } from './lib/deletion';
import { useAccountKeys, useDeletionFlow } from './store';

export const deletionKeys = {
  preview: ['account', 'deletion'] as const,
};

const CONFIRM_SCOPE = 'delete-account';

/** GET /me/deletion: no side effects, so it is simply read when the screen opens. */
export function useDeletionPreview() {
  return useQuery({ queryKey: deletionKeys.preview, queryFn: fetchDeletionPreview });
}

/** The client's bookings, to put a date on each blocker (the shared booking cache). */
export const useBookingsForBlockers = useBookingList;

/** A new blocker since the screen loaded: read the preview again and go back to it. */
function useBackToExplanation() {
  const queryClient = useQueryClient();
  return () => {
    useDeletionFlow.getState().reset();
    void queryClient.invalidateQueries({ queryKey: deletionKeys.preview });
  };
}

/** POST /me/deletion/request: the first deliberate step. Nothing is deleted by it. */
export function useRequestDeletion() {
  const backToExplanation = useBackToExplanation();
  return useMutation({
    mutationFn: requestDeletion,
    onSuccess: (challenge) => useDeletionFlow.getState().codeSent(challenge, Date.now()),
    onError: (error) => {
      if (deletionFailure(error).next === 'blocked') backToExplanation();
    },
  });
}

/**
 * POST /me/deletion/confirm: the second deliberate step, and the irreversible one. On success
 * the signed-out start is told to say so, then everything of the account is erased from the
 * phone through the sign-out path (the Stack guard then leaves the signed-in screens).
 */
export function useConfirmDeletion() {
  const backToExplanation = useBackToExplanation();
  return useMutation({
    mutationFn: (body: ConfirmAccountDeletionBody) =>
      confirmDeletion(body, useAccountKeys.getState().claimKey(CONFIRM_SCOPE, fingerprint(body))),
    onSuccess: () => {
      useAccountKeys.getState().release(CONFIRM_SCOPE);
      useDeletionFlow.getState().markDeleted();
      eraseThisDevice();
    },
    onError: (error) => {
      if (deletionFailure(error).next === 'blocked') backToExplanation();
    },
  });
}

/** The signed-out start shows "Your account is deleted" once, right after a deletion. */
export function useAccountDeletedNotice() {
  const deleted = useDeletionFlow((s) => s.deleted);
  const dismiss = useDeletionFlow((s) => s.dismissDeleted);
  return { deleted, dismiss };
}
