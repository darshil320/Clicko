'use client';

import { useEffect, useState } from 'react';
import {
  loadSession,
  onSessionChange,
  type PortalSession,
  saveSession,
} from '../src/shared/session';

/** Shown when signed in; clears the tab's session (upload checkpoints stay in IndexedDB). */
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
        onClick={() => {
          saveSession(null);
          window.location.assign('/login');
        }}
      >
        Sign out
      </button>
    </>
  );
}
