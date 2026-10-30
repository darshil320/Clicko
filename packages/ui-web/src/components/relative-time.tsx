'use client';

import * as React from 'react';
import { cn } from '../lib/cn.js';
import { formatIstExact, formatRelative } from '../lib/relative-time.js';

const TICK_MS = 60_000;

/** The current time, re-read every minute while mounted. */
function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export interface RelativeTimeProps extends Omit<React.ComponentProps<'time'>, 'dateTime'> {
  /** An ISO instant (or epoch ms). */
  readonly at: string | number;
  /** A shared clock (e.g. a table's `useNow()`), so a list ticks together. Default: own clock. */
  readonly now?: number;
}

/**
 * "in 2 h", "3 days ago" — with the exact IST moment as the hover title and in the
 * machine-readable `dateTime` (ADR-0026 D8). Ticks every minute.
 */
function RelativeTime({ at, now, className, ...props }: RelativeTimeProps) {
  const ticking = useMinuteClock();
  const ms = typeof at === 'string' ? Date.parse(at) : at;
  if (!Number.isFinite(ms)) {
    return (
      <span data-slot="relative-time" className={cn('text-muted-foreground', className)}>
        —
      </span>
    );
  }
  const iso = new Date(ms).toISOString();
  return (
    <time
      data-slot="relative-time"
      dateTime={iso}
      title={formatIstExact(at)}
      suppressHydrationWarning
      className={cn('whitespace-nowrap', className)}
      {...props}
    >
      {formatRelative(at, now ?? ticking)}
    </time>
  );
}

export { RelativeTime };
