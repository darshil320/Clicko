import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useIsSignedIn, useSession } from '@/shared/session/store';
import { fetchDevOtp, fetchMe, logout, requestOtp, verifyOtp } from './api';
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
    mutationFn: verifyOtp,
    onSuccess: (session) => {
      queryClient.clear();
      signIn(session);
      reset();
    },
  });
}

export function useDevOtp() {
  return useMutation({ mutationFn: (phone: string) => fetchDevOtp(phone) });
}

/** Keeps the cached profile (name) fresh once signed in. */
export function useMe() {
  const signedIn = useIsSignedIn();
  const setUser = useSession((s) => s.setUser);
  const query = useQuery({ queryKey: ['me'], queryFn: fetchMe, enabled: signedIn });
  useEffect(() => {
    if (query.data) setUser(query.data);
  }, [query.data, setUser]);
  return query;
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
      queryClient.clear();
    },
  });
}
