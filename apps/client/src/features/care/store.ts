import { newIdempotencyKey } from '@clickco/api-client';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { claimKey, type KeyRing, releaseKey } from '@/shared/idempotency';
import { kvStorage } from '@/shared/storage/kv';

interface CareKeysState {
  readonly keys: KeyRing;
  /** The key for this exact request in this scope: the same body reuses it, a new body mints. */
  claimKey(scope: string, fingerprint: string): string;
  /** After a success: the next request in this scope is a new intent. */
  release(scope: string): void;
  clear(): void;
}

/**
 * Idempotency keys for support tickets and quality reports, kept like checkout's: persisted, so
 * a retry after a timeout, a double tap or an app restart replays the first answer instead of
 * raising a second ticket.
 */
export const useCareKeys = create<CareKeysState>()(
  persist(
    (set, get) => ({
      keys: {},
      claimKey: (scope, fingerprint) => {
        const claimed = claimKey(get().keys, scope, fingerprint, () => newIdempotencyKey());
        if (claimed.ring !== get().keys) set({ keys: claimed.ring });
        return claimed.key;
      },
      release: (scope) => {
        const next = releaseKey(get().keys, scope);
        if (next !== get().keys) set({ keys: next });
      },
      clear: () => set({ keys: {} }),
    }),
    {
      name: 'clickco.care-keys',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ keys }) => ({ keys }),
    },
  ),
);

/** Keys belong to the person who made the request: they end with the session. */
export const clearCareKeys = (): void => useCareKeys.getState().clear();
