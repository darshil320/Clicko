'use client';

/** Dev-console customer session (simulator only). Tokens live in sessionStorage, never localStorage. */
const KEY = 'clickco.console.session';

export interface Session {
  readonly accessToken: string;
  readonly phone: string;
}

export function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function saveSession(s: Session | null): void {
  if (s) window.sessionStorage.setItem(KEY, JSON.stringify(s));
  else window.sessionStorage.removeItem(KEY);
}

export const authHeaders = (s: Session, idempotent = false): Record<string, string> => ({
  authorization: `Bearer ${s.accessToken}`,
  ...(idempotent ? { 'idempotency-key': crypto.randomUUID() } : {}),
});
