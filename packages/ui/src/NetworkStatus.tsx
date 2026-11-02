import { createContext, type ReactNode, useContext } from 'react';

export interface NetworkStatusValue {
  readonly offline: boolean;
  /** A retry started from the banner is in flight. */
  readonly retrying: boolean;
  /** Refetch what is on screen (and, in Pro, send the saved on-site actions). */
  readonly onRetry?: () => void;
}

const ONLINE_VALUE: NetworkStatusValue = { offline: false, retrying: false };

const NetworkStatusContext = createContext<NetworkStatusValue>(ONLINE_VALUE);

export interface NetworkStatusProviderProps {
  readonly value: NetworkStatusValue;
  readonly children: ReactNode;
}

/**
 * Each app's root layout provides its network status (worked out in its src/shared/network from
 * request outcomes); every Screen below shows the offline banner from it. Without a provider
 * the app reads as online.
 */
export function NetworkStatusProvider({ value, children }: NetworkStatusProviderProps) {
  return <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>;
}

export function useNetworkStatus(): NetworkStatusValue {
  return useContext(NetworkStatusContext);
}
