import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useIsSignedIn } from '../session/store';
import { flushQueue } from './runner';
import { useOnsiteQueue } from './store';

const FLUSH_EVERY_MS = 15_000;

/**
 * Keeps the offline queue draining while signed in (ADR-0024 D5): on mount, whenever the app
 * returns to the foreground (retrying everything at once), and every 15 s while anything waits.
 */
export function useQueueRunner(): void {
  const signedIn = useIsSignedIn();
  const hasPending = useOnsiteQueue((s) => s.pending.length > 0);

  useEffect(() => {
    if (!signedIn) return;
    void flushQueue();
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      useOnsiteQueue.getState().retryAll();
      void flushQueue();
    });
    return () => sub.remove();
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || !hasPending) return;
    const timer = setInterval(() => void flushQueue(), FLUSH_EVERY_MS);
    return () => clearInterval(timer);
  }, [signedIn, hasPending]);
}
