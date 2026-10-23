'use client';

import type { ProSessionPhotographer, TokenPair } from '@clickco/contracts';

/**
 * The photographer's sign-in, in sessionStorage (tab-scoped, never localStorage — ADR-0014 D6).
 * Closing the tab signs out; upload checkpoints survive in IndexedDB and resume after signing in.
 */
const KEY = 'clickco.portal.session';

export interface PortalSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly photographer: ProSessionPhotographer;
}

type Listener = (s: PortalSession | null) => void;
const listeners = new Set<Listener>();

export function loadSession(): PortalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalSession;
  } catch {
    window.sessionStorage.removeItem(KEY);
    return null;
  }
}

export function saveSession(s: PortalSession | null): void {
  if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
  else window.sessionStorage.removeItem(KEY);
  for (const l of listeners) l(s);
}

export function updateTokens(pair: TokenPair): void {
  const current = loadSession();
  if (current)
    saveSession({ ...current, accessToken: pair.accessToken, refreshToken: pair.refreshToken });
}

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
