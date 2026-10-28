import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { kvStorage } from '../storage/kv';
import {
  type AttemptOutcome,
  applyOutcome,
  dismissFailed,
  EMPTY_QUEUE,
  enqueue,
  expireStale,
  keepOnly,
  type NewQueuedAction,
  type QueueState,
  retryNow,
} from './queue';

interface QueueStore extends QueueState {
  add(item: NewQueuedAction): void;
  settle(id: string, outcome: AttemptOutcome): void;
  retryAll(): void;
  dismiss(id: string): void;
  expireStale(): void;
  keepOnly(photographerId: string): void;
  clear(): void;
}

const stateOf = ({ pending, failed }: QueueState): QueueState => ({ pending, failed });

/**
 * The on-site write-ahead queue, persisted in MMKV so it survives the app being killed in a
 * basement with no signal (G-19). Every change goes through the pure functions in queue.ts.
 */
export const useOnsiteQueue = create<QueueStore>()(
  persist<QueueStore, [], [], QueueState>(
    (set, get) => ({
      ...EMPTY_QUEUE,
      add: (item) => set(enqueue(stateOf(get()), item, new Date())),
      settle: (id, outcome) => set(applyOutcome(stateOf(get()), id, outcome, new Date())),
      retryAll: () => set(retryNow(stateOf(get()), new Date())),
      dismiss: (id) => set(dismissFailed(stateOf(get()), id)),
      expireStale: () => set(expireStale(stateOf(get()), new Date())),
      keepOnly: (photographerId) => set(keepOnly(stateOf(get()), photographerId)),
      clear: () => set(EMPTY_QUEUE),
    }),
    {
      name: 'clickco.pro.onsite-queue',
      version: 1,
      storage: createJSONStorage(() => kvStorage),
      partialize: stateOf,
    },
  ),
);

/*
 * Not cleared on session expiry: a photographer whose session lapsed while offline signs in again
 * and the saved actions still go (ADR-0024 D5). Explicit sign-out clears it (after a warning);
 * a different photographer signing in keeps only their own (keepOnly).
 */

export const usePendingCount = (): number => useOnsiteQueue((s) => s.pending.length);
