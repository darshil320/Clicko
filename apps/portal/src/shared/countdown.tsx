'use client';

import { formatCountdown } from './format';
import { useNow } from './hooks';

const TICK_MS = 1_000;

/**
 * "2 h 14 min left" / "Overdue by 5 min" to an upload deadline. It owns the per-second clock, so
 * only this text re-renders — not the job list or upload screen around it.
 */
export function DeadlineCountdown({
  deadlineAt,
  testId,
}: {
  readonly deadlineAt: string;
  readonly testId?: string;
}) {
  const now = useNow(TICK_MS);
  const { text, overdue } = formatCountdown(Date.parse(deadlineAt), now);
  return (
    <span className={overdue ? 'countdown overdue' : 'countdown'} data-testid={testId}>
      {text}
    </span>
  );
}
