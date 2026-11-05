import type { TokenStore } from '@clickco/api-client';
import type { SessionUser, TokenPair, VerifyOtpResponse } from '@clickco/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { compactKv, kvStorage, wipeKv } from '../storage/kv';
import { eraseDeletedAccount } from './erase';
import { runSessionEndResets, type SessionEndReason } from './reset';

export type SignedInUser = Omit<SessionUser, 'isNew'>;

interface SessionState {
  readonly tokens: TokenPair | null;
  readonly user: SignedInUser | null;
  signIn(response: VerifyOtpResponse): void;
  setTokens(tokens: TokenPair): void;
  setUser(user: SignedInUser): void;
  /** Forgets the session and runs every session-end reset; 'account-deleted' also drops device choices. */
  signOut(reason?: SessionEndReason): void;
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
      signOut: (reason = 'signed-out') => {
        set({ tokens: null, user: null });
        runSessionEndResets(reason);
        compactKv();
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

/**
 * After the API confirms an account deletion (ADR-0030): the ordinary sign-out path with the 'account-deleted' reason
 * (tokens, user, booking draft, every key ring, the query cache, the shoot location), then every
 * key left in the store, so nothing of the account stays on this phone.
 */
export const eraseThisDevice = (): void =>
  eraseDeletedAccount({
    endSession: (reason) => useSession.getState().signOut(reason),
    wipeStorage: wipeKv,
  });

export const useIsSignedIn = (): boolean => useSession((s) => s.tokens !== null);

/** The api-client's view of the session: read on every request, updated on refresh. */
export const sessionTokenStore: TokenStore = {
  getAccessToken: () => useSession.getState().tokens?.accessToken ?? null,
  getRefreshToken: () => useSession.getState().tokens?.refreshToken ?? null,
  setTokens: (tokens) => useSession.getState().setTokens(tokens),
  clear: () => useSession.getState().signOut(),
};
