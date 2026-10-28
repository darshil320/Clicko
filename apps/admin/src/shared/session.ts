'use client';

import type { TokenStore } from '@clickco/api-client';
import { StaffProfile, type TokenPair } from '@clickco/contracts';
import { useSyncExternalStore } from 'react';

/**
 * The staff session, in sessionStorage only (ADR-0025 D6, as the portal — ADR-0014 D6): it is
 * tab-scoped, closing the tab signs out, and nothing outlives the tab. Never localStorage.
 */
const SESSION_KEY = 'clickco.admin.session';
const ACTIVITY_KEY = 'clickco.admin.activity';

export interface StaffSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly staff: StaffProfile;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedRaw: string | null = null;
let cachedSession: StaffSession | null = null;

const storage = (): Storage | null =>
  typeof window === 'undefined' ? null : window.sessionStorage;

/** Parses the stored session; anything malformed is discarded (storage is not trusted). */
function parse(raw: string): StaffSession | null {
  try {
    const value = JSON.parse(raw) as Partial<StaffSession>;
    const staff = StaffProfile.safeParse(value.staff);
    if (
      typeof value.accessToken !== 'string' ||
      typeof value.refreshToken !== 'string' ||
      !staff.success
    ) {
      return null;
    }
    return { accessToken: value.accessToken, refreshToken: value.refreshToken, staff: staff.data };
  } catch {
    return null;
  }
}

/** The current session. Stable between changes, so it can back useSyncExternalStore. */
export function loadSession(): StaffSession | null {
  const raw = storage()?.getItem(SESSION_KEY) ?? null;
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  cachedSession = raw === null ? null : parse(raw);
  if (raw !== null && cachedSession === null) storage()?.removeItem(SESSION_KEY);
  return cachedSession;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function saveSession(session: StaffSession): void {
  storage()?.setItem(SESSION_KEY, JSON.stringify(session));
  emit();
}

export function clearSession(): void {
  storage()?.removeItem(SESSION_KEY);
  storage()?.removeItem(ACTIVITY_KEY);
  emit();
}

/** Keeps the tokens, replaces the profile (after GET /admin/me). */
export function updateStaff(staff: StaffProfile): void {
  const current = loadSession();
  if (current) saveSession({ ...current, staff });
}

export function onSessionChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The session in React; null on the server and before sign-in. */
export function useSession(): StaffSession | null {
  return useSyncExternalStore(onSessionChange, loadSession, () => null);
}

/** False during the server render and hydration, true once the browser has taken over. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

/** The SDK's view of the session: it reads and rotates tokens but never persists anything else. */
export const sessionTokens: TokenStore = {
  getAccessToken: () => loadSession()?.accessToken ?? null,
  getRefreshToken: () => loadSession()?.refreshToken ?? null,
  setTokens: (pair: TokenPair) => {
    const current = loadSession();
    if (current) {
      saveSession({ ...current, accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    }
  },
  clear: clearSession,
};

/** The last time the person used the panel (for the idle sign-out), or null. */
export function lastActivity(): number | null {
  const raw = storage()?.getItem(ACTIVITY_KEY);
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

export function recordActivity(at: number): void {
  storage()?.setItem(ACTIVITY_KEY, String(at));
}
