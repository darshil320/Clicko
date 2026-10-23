import { useEffect, useState } from 'react';

/** Wall-clock time that re-renders every `intervalMs` (countdowns, "today" boundaries). */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
