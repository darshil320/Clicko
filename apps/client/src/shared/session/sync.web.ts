import { useSession } from './store';

const SESSION_KEY = 'clickco.session';

/**
 * Each browser tab holds the session in memory. When another tab rotates the refresh token
 * (or signs out), re-read it from storage, so this tab never presents a rotated token — which
 * the API treats as reuse and answers by revoking every session.
 */
export function syncSessionAcrossTabs(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.endsWith(SESSION_KEY)) void useSession.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
