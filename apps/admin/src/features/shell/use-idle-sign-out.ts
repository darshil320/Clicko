'use client';

import { useEffect, useRef } from 'react';
import { IDLE_CHECK_MS, isIdle, shouldRecordActivity } from '../../shared/idle';
import { lastActivity, recordActivity } from '../../shared/session';
import { signOut } from '../../shared/sign-out';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;

/**
 * Signs out after 30 minutes without activity (ADR-0025 D6). Activity is written to the tab's
 * sessionStorage, so a reload after a long idle also signs out.
 */
export function useIdleSignOut(active: boolean): void {
  const lastWritten = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const check = () => {
      if (isIdle(lastActivity(), Date.now())) void signOut('idle');
    };
    const onActivity = () => {
      const now = Date.now();
      if (!shouldRecordActivity(lastWritten.current, now)) return;
      lastWritten.current = now;
      recordActivity(now);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    if (lastActivity() === null) onActivity();
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, IDLE_CHECK_MS);
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [active]);
}
