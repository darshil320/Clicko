import { newIdempotencyKey } from '@clickco/api-client';
import type { AccountDeletionChallenge } from '@clickco/contracts';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { claimKey, type KeyRing, releaseKey } from '@/shared/idempotency';
import { kvStorage } from '@/shared/storage/kv';

interface AccountKeysState {
  readonly keys: KeyRing;
  claimKey(scope: string, fingerprint: string): string;
  release(scope: string): void;
  clear(): void;
}

/**
 * The Idempotency-Key for confirming a deletion, persisted like the other key rings: a retry
 * after a lost answer (or an app restart) replays the first answer instead of failing.
 */
export const useAccountKeys = create<AccountKeysState>()(
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
      name: 'clickco.account-keys',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: ({ keys }) => ({ keys }),
    },
  ),
);

/** Keys belong to the person who made the request: they end with the session. */
export const clearAccountKeys = (): void => useAccountKeys.getState().clear();

export interface SentCode {
  readonly challengeId: string;
  /** Epoch ms when "Resend code" unlocks. */
  readonly resendAt: number;
  /** Epoch ms when the code stops working. */
  readonly expiresAt: number;
}

interface DeletionFlowState {
  /** The code step is showing once a code was sent; null on the explanation. */
  readonly sent: SentCode | null;
  /** The account was just deleted: the signed-out start says so once. */
  readonly deleted: boolean;
  codeSent(challenge: AccountDeletionChallenge, nowMs: number): void;
  /** Back to the explanation (leaving the screen, or a new blocker). */
  reset(): void;
  markDeleted(): void;
  dismissDeleted(): void;
}

/** The in-progress deletion. Ephemeral: never persisted, so it never outlives the app. */
export const useDeletionFlow = create<DeletionFlowState>()((set) => ({
  sent: null,
  deleted: false,
  codeSent: (challenge, nowMs) =>
    set({
      sent: {
        challengeId: challenge.challengeId,
        resendAt: nowMs + challenge.resendAfterSeconds * 1000,
        expiresAt: Date.parse(challenge.expiresAt),
      },
    }),
  reset: () => set({ sent: null }),
  markDeleted: () => set({ sent: null, deleted: true }),
  dismissDeleted: () => set({ deleted: false }),
}));
