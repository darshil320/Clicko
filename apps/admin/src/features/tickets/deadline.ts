import { type AdminTicketItem, ticketClock } from '@clickco/contracts';
import type { BadgeVariant } from '@clickco/ui-web';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 45 min → "45 min"; 6 h → "6 h"; 2 days → "2 days" (rounded down, never "0 min"). */
export function spanLabel(ms: number): string {
  const abs = Math.max(Math.abs(ms), MINUTE);
  if (abs < HOUR) return `${Math.floor(abs / MINUTE)} min`;
  if (abs < 2 * DAY) return `${Math.floor(abs / HOUR)} h`;
  const days = Math.floor(abs / DAY);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export interface DeadlineChip {
  readonly label: string;
  readonly tone: BadgeVariant;
}

type Clocked = Pick<AdminTicketItem, 'ackDueAt' | 'acknowledgedAt' | 'resolveDueAt' | 'resolvedAt'>;

/**
 * SA-02 deadline chip: "Reply in 6 h" (amber when close), "Reply overdue by 2 days" (red),
 * then "Resolve in 12 days" / "Resolve overdue by 3 h", and finally "Resolved on time" or
 * "Resolved late".
 */
export function deadlineChip(t: Clocked, nowMs: number): DeadlineChip {
  const clock = ticketClock(t, nowMs);
  const verb = clock.kind === 'ACK' ? 'Reply' : 'Resolve';
  const left = Date.parse(clock.dueAt) - nowMs;
  switch (clock.state) {
    case 'MET':
      return { label: 'Resolved on time', tone: 'success' };
    case 'MET_LATE':
      return { label: 'Resolved late', tone: 'destructive' };
    case 'OVERDUE':
      return { label: `${verb} overdue by ${spanLabel(left)}`, tone: 'destructive' };
    case 'DUE_SOON':
      return { label: `${verb} in ${spanLabel(left)}`, tone: 'warning' };
    case 'ON_TRACK':
      return { label: `${verb} in ${spanLabel(left)}`, tone: 'outline' };
  }
}
