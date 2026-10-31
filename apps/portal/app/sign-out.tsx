'use client';

import { useEffect, useState } from 'react';
import { browserCheckpointStore } from '../src/features/upload/checkpoints';
import { signOut } from '../src/shared/api';
import { initials } from '../src/shared/format';
import { Icon } from '../src/shared/icons';
import { loadSession, onSessionChange, type PortalSession } from '../src/shared/session';
import { useIdleSignOut } from '../src/shared/use-idle-sign-out';

/**
 * The signed-in header: a link to the shoots, who is signed in, and Sign out. Signing out revokes
 * the session on the server and clears this photographer's upload checkpoints from the browser
 * (shared machines, security review L8). Closing the tab instead keeps the checkpoints for a quick
 * resume. Signed out, the header shows only the brand.
 */
export function SignOut() {
  const [session, setSession] = useState<PortalSession | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    setSession(loadSession());
    return onSessionChange(setSession);
  }, []);
  // 30 minutes without activity signs out (audit L4); this header is on every page.
  useIdleSignOut(session !== null);
  if (!session) return null;
  const name = session.photographer.displayName;
  return (
    <>
      <a className="nav-link" href="/jobs">
        Your shoots
      </a>
      <div className="user">
        <span className="avatar" aria-hidden="true">
          {initials(name)}
        </span>
        <span className="user-name">{name}</span>
        <button
          type="button"
          className="ghost sm"
          disabled={leaving}
          onClick={async () => {
            setLeaving(true);
            await browserCheckpointStore()
              .removeForPhotographer(session.photographer.id)
              .catch(() => undefined);
            await signOut();
            window.location.assign('/login');
          }}
        >
          <Icon name="signOut" size="sm" />
          <span className="sm-hidden">{leaving ? 'Signing out…' : 'Sign out'}</span>
        </button>
      </div>
    </>
  );
}
