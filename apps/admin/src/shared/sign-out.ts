'use client';

import { createAdminApiClient } from '@clickco/api-client';
import { safeNext } from './safe-next';
import { resolveApiUrl } from './security-headers';
import { clearSession, loadSession } from './session';

export type SignOutReason = 'idle' | 'expired' | 'manual';

let leaving = false;

/** The sign-in page for a reason: `/sign-in?reason=idle`. */
export function signInPath(reason: SignOutReason | null, next?: string): string {
  const params = new URLSearchParams();
  if (reason && reason !== 'manual') params.set('reason', reason);
  // Only the path matters, so any origin works for parsing when there is no window (tests).
  const origin = typeof window === 'undefined' ? 'http://panel.invalid' : window.location.origin;
  const safe = safeNext(next, origin);
  if (safe) params.set('next', safe);
  const query = params.toString();
  return query ? `/sign-in?${query}` : '/sign-in';
}

/**
 * Ends the staff session: revokes the refresh token on the server (best-effort, ADR-0015 M7),
 * clears the tab's storage and reloads to sign-in, dropping every cached query with the page.
 * Safe to call more than once.
 */
export async function signOut(reason: SignOutReason): Promise<void> {
  if (leaving) return;
  leaving = true;
  const current = loadSession();
  clearSession();
  if (current) {
    // A client without tokens: the logout call must not trigger a refresh or another sign-out.
    const api = createAdminApiClient({
      baseUrl: resolveApiUrl(process.env.NEXT_PUBLIC_API_URL, false),
    });
    await api.auth.logout(current.refreshToken).catch(() => undefined);
  }
  // The path only: a board search in the query string can hold a client's phone (review L4).
  const next = reason === 'manual' ? undefined : window.location.pathname;
  window.location.assign(signInPath(reason, next));
}
