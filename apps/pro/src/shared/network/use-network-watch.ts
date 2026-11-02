import type { NetworkStatusValue } from '@clickco/ui';
import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { reportCacheAction, reportDeviceOnline, useIsOffline } from './store';

/** While offline, look again this often (foreground only) so the banner clears by itself. */
const PROBE_EVERY_MS = 30_000;
/** A retry against a paused query never settles; the button stops spinning after this. */
const RETRY_BUSY_MAX_MS = 10_000;

const settleWithin = (work: Promise<unknown>, ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });

/**
 * The app's network status for Screen's offline banner (NetworkStatusProvider): every query and
 * mutation outcome, every on-site send (runner.ts), plus the browser's online flag on web.
 * Retry refetches what is on screen and runs `alsoOnRetry` (sending the saved on-site actions).
 */
export function useNetworkWatch(
  queryClient: QueryClient,
  alsoOnRetry?: () => void,
): NetworkStatusValue {
  const offline = useIsOffline();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const queries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type === 'updated') reportCacheAction(event.action);
    });
    const mutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated') reportCacheAction(event.action);
    });
    reportDeviceOnline(onlineManager.isOnline());
    const device = onlineManager.subscribe(reportDeviceOnline);
    return () => {
      queries();
      mutations();
      device();
    };
  }, [queryClient]);

  const refetchVisible = useCallback(
    () => queryClient.refetchQueries({ type: 'active' }),
    [queryClient],
  );

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => {
      if (focusManager.isFocused()) void refetchVisible();
    }, PROBE_EVERY_MS);
    return () => clearInterval(timer);
  }, [offline, refetchVisible]);

  const onRetry = useCallback(() => {
    setRetrying(true);
    alsoOnRetry?.();
    void settleWithin(refetchVisible(), RETRY_BUSY_MAX_MS).then(() => setRetrying(false));
  }, [refetchVisible, alsoOnRetry]);

  return useMemo(() => ({ offline, retrying, onRetry }), [offline, retrying, onRetry]);
}
