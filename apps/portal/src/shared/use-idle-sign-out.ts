'use client';

import { useEffect } from 'react';
import { signOut } from './api';
import { IDLE_CHECK_MS, isIdle, shouldRecordActivity } from './idle';
import { lastActivity, recordActivity } from './session';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'] as const;

let lastWritten: number | null = null;

/**
 * Notes that the photographer is active. Rate-limited, so it is cheap to call from busy places
 * (input events, upload progress — a long upload must never be cut off by the idle sign-out).
 */
export function markActive(now: number = Date.now()): void {
  if (!shouldRecordActivity(lastWritten, now)) return;
  lastWritten = now;
  recordActivity(now);
}

/**
 * Signs out after 30 minutes without activity (audit L4, as the admin panel — ADR-0025 D6).
 * Activity lives in the tab's sessionStorage, so a reload after a long idle also signs out.
 * Upload checkpoints are kept (as when the tab is closed) so the photographer can resume.
 */
export function useIdleSignOut(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let leaving = false;
    const check = () => {
      if (leaving || !isIdle(lastActivity(), Date.now())) return;
      leaving = true;
      void signOut().finally(() => window.location.assign('/login'));
    };
    const onActivity = () => markActive();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    check();
    if (lastActivity() === null) markActive();
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
