'use client';

import type { ProSessionPhotographer, TokenPair } from '@clickco/contracts';

/**
 * The photographer's sign-in, in sessionStorage (tab-scoped, never localStorage — ADR-0014 D6).
 * Closing the tab signs out; upload checkpoints survive in IndexedDB and resume after signing in.
 */
const KEY = 'clickco.portal.session';
/** Last activity time (ms) for the 30-minute idle sign-out (audit L4). Tab-scoped as the session. */
const ACTIVITY_KEY = 'clickco.portal.activity';

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
  else {
    window.sessionStorage.removeItem(KEY);
    window.sessionStorage.removeItem(ACTIVITY_KEY);
  }
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

/** The last time the photographer used the portal (for the idle sign-out), or null. */
export function lastActivity(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(ACTIVITY_KEY);
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function recordActivity(at: number): void {
  if (typeof window !== 'undefined') window.sessionStorage.setItem(ACTIVITY_KEY, String(at));
}
