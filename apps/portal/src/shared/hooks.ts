'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { loadSession, onSessionChange, type PortalSession } from './session';

/** The signed-in photographer; sends anyone signed out to /login. */
export function useRequireSession(): PortalSession | null {
  const router = useRouter();
  const [session, setSession] = useState<PortalSession | null>(null);
  useEffect(() => {
    const current = loadSession();
    if (!current) {
      router.replace('/login');
      return;
    }
    setSession(current);
    return onSessionChange((next) => {
      if (!next) router.replace('/login');
      setSession(next);
    });
  }, [router]);
  return session;
}

/** Wall-clock milliseconds, re-rendering every `everyMs` (live countdowns). */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
