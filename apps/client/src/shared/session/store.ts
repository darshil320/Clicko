import type { TokenStore } from '@clickco/api-client';
import type { SessionUser, TokenPair, VerifyOtpResponse } from '@clickco/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { kvStorage } from '../storage/kv';
import { runSessionEndResets } from './reset';

export type SignedInUser = Omit<SessionUser, 'isNew'>;

interface SessionState {
  readonly tokens: TokenPair | null;
  readonly user: SignedInUser | null;
  signIn(response: VerifyOtpResponse): void;
  setTokens(tokens: TokenPair): void;
  setUser(user: SignedInUser): void;
  signOut(): void;
}

/**
 * The signed-in session, persisted in MMKV. Lives in shared/ because every feature's API
 * calls need the token; only features/auth writes a new session.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      tokens: null,
      user: null,
      signIn: ({ user, ...tokens }) =>
        set({
          tokens,
          user: { id: user.id, phone: user.phone, fullName: user.fullName },
        }),
      setTokens: (tokens) => set({ tokens }),
      setUser: (user) => set({ user }),
      signOut: () => {
        set({ tokens: null, user: null });
        runSessionEndResets();
      },
    }),
    {
      name: 'clickco.session',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ tokens, user }) => ({ tokens, user }),
    },
  ),
);

export const useIsSignedIn = (): boolean => useSession((s) => s.tokens !== null);

/** The api-client's view of the session: read on every request, updated on refresh. */
export const sessionTokenStore: TokenStore = {
  getAccessToken: () => useSession.getState().tokens?.accessToken ?? null,
  getRefreshToken: () => useSession.getState().tokens?.refreshToken ?? null,
  setTokens: (tokens) => useSession.getState().setTokens(tokens),
  clear: () => useSession.getState().signOut(),
};
