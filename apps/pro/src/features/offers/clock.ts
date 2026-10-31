import { useEffect, useState } from 'react';
import { nextExpiryDelayMs } from './lib/countdown';

/**
 * Wall-clock time that moves only when one of `expiresAts` closes — the moment a list or a
 * screen has to change. The per-second countdown text lives in OfferCountdown, so the rest of
 * the tree is not re-rendered every second.
 */
export function useExpiryClock(expiresAts: readonly string[]): Date {
  const [now, setNow] = useState(() => new Date());
  // A string key: a refetch that returns the same offers keeps the same timer.
  const key = expiresAts.join('|');
  useEffect(() => {
    // Measured from the rendered `now`: an offer that closed since then fires at once.
    const delay = nextExpiryDelayMs(key === '' ? [] : key.split('|'), now);
    if (delay === null) return;
    const elapsed = Date.now() - now.getTime();
    const timer = setTimeout(() => setNow(new Date()), Math.max(0, delay - elapsed));
    return () => clearTimeout(timer);
  }, [key, now]);
  return now;
}
