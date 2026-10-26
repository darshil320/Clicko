'use client';

import { type RefObject, useEffect, useState, useSyncExternalStore } from 'react';
import type { ShootPreset } from './types';

const noSubscription = () => () => {};

/** False on the server and while hydrating; true once React runs in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** Links of the form `#shoot-<moment id>` fill the picker with that moment's shoot. */
export const PRESET_HASH = '#shoot-';

/**
 * Applies a preset when the page opens on, or moves to, a `#shoot-…` link, then brings the picker
 * into view and swaps the hash for the picker's own anchor, so the same link works twice.
 */
export function usePrefill(
  presets: Readonly<Record<string, ShootPreset>>,
  apply: (preset: ShootPreset) => void,
  target: RefObject<HTMLElement | null>,
  anchor: string,
): void {
  useEffect(() => {
    const onHash = () => {
      if (!window.location.hash.startsWith(PRESET_HASH)) return;
      const preset = presets[window.location.hash.slice(PRESET_HASH.length)];
      if (!preset) return;
      apply(preset);
      window.history.replaceState(null, '', `#${anchor}`);
      target.current?.scrollIntoView({ block: 'start' });
    };
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [presets, apply, target, anchor]);
}

/**
 * True while `target` has scrolled up out of view and `until` (if any) is not yet on screen:
 * the window in which the mobile shoot bar is useful.
 */
export function useScrolledPast(target: RefObject<HTMLElement | null>, untilId?: string): boolean {
  const [past, setPast] = useState(false);
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    const node = target.current;
    if (!node) return;
    const watch = new IntersectionObserver(([entry]) => {
      if (entry) setPast(!entry.isIntersecting && entry.boundingClientRect.bottom < 0);
    });
    watch.observe(node);
    const until = untilId ? document.getElementById(untilId) : null;
    // Once the waitlist is on screen or above it, the page has its own call to action.
    const stop = new IntersectionObserver(([entry]) =>
      setEnded(entry ? entry.isIntersecting || entry.boundingClientRect.top < 0 : false),
    );
    if (until) stop.observe(until);
    return () => {
      watch.disconnect();
      stop.disconnect();
    };
  }, [target, untilId]);
  return past && !ended;
}
