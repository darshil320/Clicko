'use client';

import { useEffect, useState } from 'react';
import { pollDelay } from './poll';

export interface PollOptions<T> {
  /** Healthy cadence. */
  readonly everyMs: number;
  /** Nothing loads until this is true (e.g. a session exists). */
  readonly enabled?: boolean;
  /** Once a value is final there is nothing left to watch: polling stops. */
  readonly isFinal?: (value: T) => boolean;
}

export interface PollState<T> {
  /** The last value loaded; kept while a later poll fails. */
  readonly data: T | undefined;
  /** The last poll's failure, cleared by the next success. */
  readonly error: unknown;
}

const IDLE = { data: undefined, error: null } as const;

/**
 * Loads now, then again every `everyMs` — but never while the tab is hidden (it reloads when
 * the tab comes back), never after a final value, and backing off (×2 per failure in a row,
 * jittered, capped at 120 s) while the API keeps failing. `load` must be stable (useCallback).
 */
export function usePoll<T>(load: () => Promise<T>, options: PollOptions<T>): PollState<T> {
  const { everyMs, enabled = true, isFinal } = options;
  const [state, setState] = useState<PollState<T>>(IDLE);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    let done = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      if (!live || done || document.hidden) return;
      timer = setTimeout(tick, pollDelay(everyMs, failures, Math.random()));
    };
    async function tick() {
      if (busy) return;
      busy = true;
      try {
        const value = await load();
        if (!live) return;
        failures = 0;
        done = isFinal?.(value) ?? false;
        setState({ data: value, error: null });
      } catch (error: unknown) {
        if (!live) return;
        failures += 1;
        setState((previous) => ({ data: previous.data, error }));
      } finally {
        busy = false;
        schedule();
      }
    }
    const onVisibility = () => {
      if (document.hidden) clearTimeout(timer);
      else if (!done) void tick();
    };

    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, enabled, everyMs, isFinal]);

  return state;
}
