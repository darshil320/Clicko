'use client';

import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/** The current time, ticking every minute — for "in 2 h" / "25 min overdue" labels. */
export function useNow(intervalMs = MINUTE_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}
