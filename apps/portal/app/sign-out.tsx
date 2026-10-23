'use client';

import { useEffect, useState } from 'react';
import { browserCheckpointStore } from '../src/features/upload/checkpoints';
import { signOut } from '../src/shared/api';
import { loadSession, onSessionChange, type PortalSession } from '../src/shared/session';

/**
 * Shown when signed in. Signing out revokes the session on the server and clears this
 * photographer's upload checkpoints from the browser (shared machines, security review L8).
 * Closing the tab instead keeps the checkpoints for a quick resume.
 */
export function SignOut() {
  const [session, setSession] = useState<PortalSession | null>(null);
  useEffect(() => {
    setSession(loadSession());
    return onSessionChange(setSession);
  }, []);
  if (!session) return null;
  return (
    <>
      <span className="muted small">{session.photographer.displayName}</span>
      <button
        type="button"
        className="link"
        onClick={async () => {
          await browserCheckpointStore()
            .removeForPhotographer(session.photographer.id)
            .catch(() => undefined);
          await signOut();
          window.location.assign('/login');
        }}
      >
        Sign out
      </button>
    </>
  );
}
