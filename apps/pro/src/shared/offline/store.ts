import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { onSessionEnd } from '../session/reset';
import { kvStorage } from '../storage/kv';
import {
  type AttemptOutcome,
  applyOutcome,
  dismissFailed,
  EMPTY_QUEUE,
  enqueue,
  type NewQueuedAction,
  type QueueState,
  retryNow,
} from './queue';

interface QueueStore extends QueueState {
  add(item: NewQueuedAction): void;
  settle(id: string, outcome: AttemptOutcome): void;
  retryAll(): void;
  dismiss(id: string): void;
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

/** Signing out hands the phone to someone else: nothing of this photographer's stays queued. */
onSessionEnd(() => useOnsiteQueue.getState().clear());

export const usePendingCount = (): number => useOnsiteQueue((s) => s.pending.length);
