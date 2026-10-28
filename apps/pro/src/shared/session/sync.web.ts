import { useOnsiteQueue } from '../offline/store';
import { useSession } from './store';

const SESSION_KEY = 'clickco.pro.session';
const QUEUE_KEY = 'clickco.pro.onsite-queue';

/**
 * Each browser tab holds the session in memory. When another tab rotates the refresh token
 * (or signs out), re-read it from storage, so this tab never presents a rotated token — which
 * the API treats as reuse and answers by revoking every session.
 */
export function syncSessionAcrossTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.endsWith(SESSION_KEY)) void useSession.persist.rehydrate();
    // The other tab may have signed out (clearing the queue) or saved an action: never write a
    // stale copy back over it.
    if (event.key?.endsWith(QUEUE_KEY)) void useOnsiteQueue.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
