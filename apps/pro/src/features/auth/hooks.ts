import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOnsiteQueue } from '@/shared/offline/store';
import { useSession } from '@/shared/session/store';
import { fetchDevOtp, logout, requestOtp, verifyOtp } from './api';
import { deviceId } from './device-id';
import { useSignInFlow } from './store';

export function useRequestOtp() {
  const challengeSent = useSignInFlow((s) => s.challengeSent);
  return useMutation({
    mutationFn: (phone: string) => requestOtp(phone),
    onSuccess: (challenge, phone) =>
      challengeSent({
        phone,
        challengeId: challenge.challengeId,
        resendAfterSeconds: challenge.resendAfterSeconds,
      }),
  });
}

export function useVerifyOtp() {
  const signIn = useSession((s) => s.signIn);
  const reset = useSignInFlow((s) => s.reset);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { challengeId: string; phone: string; code: string }) =>
      verifyOtp({ ...input, deviceId: deviceId() }),
    onSuccess: (session, { phone }) => {
      queryClient.clear();
      // Saved on-site actions survive an expired session, but only for the same photographer.
      useOnsiteQueue.getState().keepOnly(session.photographer.id);
      signIn(session, phone);
      reset();
    },
  });
}

export function useDevOtp() {
  return useMutation({ mutationFn: (phone: string) => fetchDevOtp(phone) });
}

/** Revokes the refresh token server-side (best effort), then forgets the session locally. */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const refreshToken = useSession.getState().tokens?.refreshToken;
      if (refreshToken) await logout(refreshToken).catch(() => undefined);
    },
    onSettled: () => {
      useSession.getState().signOut();
      // Explicit sign-out (the photographer was warned about anything unsent): nothing stays.
      useOnsiteQueue.getState().clear();
      queryClient.clear();
    },
  });
}
