import type { TokenStore } from '@clickco/api-client';
import type { ProSessionPhotographer, ProVerifyOtpResponse, TokenPair } from '@clickco/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { compactKv, kvStorage } from '../storage/kv';
import { runSessionEndResets } from './reset';

export interface SignedInPhotographer extends ProSessionPhotographer {
  /** The number they signed in with (the API does not echo it back). */
  readonly phone: string;
}

interface SessionState {
  readonly tokens: TokenPair | null;
  readonly photographer: SignedInPhotographer | null;
  signIn(response: ProVerifyOtpResponse, phone: string): void;
  setTokens(tokens: TokenPair): void;
  signOut(): void;
}

/**
 * The photographer's session, persisted in MMKV. Lives in shared/ because every feature's API
 * calls need the token; only features/auth writes a new session.
 */
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      tokens: null,
      photographer: null,
      signIn: ({ photographer, ...tokens }, phone) =>
        set({ tokens, photographer: { ...photographer, phone } }),
      setTokens: (tokens) => set({ tokens }),
      signOut: () => {
        set({ tokens: null, photographer: null });
        runSessionEndResets();
        compactKv();
      },
    }),
    {
      name: 'clickco.pro.session',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ tokens, photographer }) => ({ tokens, photographer }),
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
