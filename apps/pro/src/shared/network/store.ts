import {
  type CacheActionLike,
  isOfflineState,
  type NetworkSignal,
  type NetworkState,
  nextNetworkState,
  ONLINE,
  signalFromAction,
  signalFromError,
} from '@clickco/ui/state';
import { create } from 'zustand';
import { isOffline } from '../errors';

interface NetworkStore {
  readonly state: NetworkState;
  report(signal: NetworkSignal): void;
}

/**
 * Whether the app can reach Clickco, learnt from request outcomes (there is no device network
 * API in the app). In memory only: every launch starts online.
 */
export const useNetworkStore = create<NetworkStore>()((set, get) => ({
  state: ONLINE,
  report: (signal) => {
    const next = nextNetworkState(get().state, signal);
    if (next !== get().state) set({ state: next });
  },
}));

/** A TanStack query/mutation cache action, fed in by useNetworkWatch. */
export function reportCacheAction(action: CacheActionLike): void {
  const signal = signalFromAction(action, isOffline);
  if (signal) useNetworkStore.getState().report(signal);
}

/** A request outside TanStack (an on-site send) got an answer. */
export const reportAnswered = (): void => useNetworkStore.getState().report({ type: 'answered' });

/** A request outside TanStack failed (or answered with an HTTP error). */
export const reportRequestError = (error: unknown): void =>
  useNetworkStore.getState().report(signalFromError(error, isOffline));

export const reportDeviceOnline = (online: boolean): void =>
  useNetworkStore.getState().report({ type: 'device', online });

export const useIsOffline = (): boolean => useNetworkStore((s) => isOfflineState(s.state));
