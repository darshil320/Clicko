import type { ProAssignmentDetail } from '@clickco/contracts';
import { Card, Text } from '@clickco/ui';
import { formatHours } from '@/shared/format/datetime';
import { useNow } from '@/shared/hooks/useNow';
import type { JobProjection } from '../lib/project';
import { formatClock, formatElapsed } from '../lib/timing';

/** Whole minutes on screen: a few seconds' lag at the minute boundary is invisible. */
const TIMER_TICK_MS = 5000;

function spoken(text: string): string {
  return text.replace(/(\d+)h/, '$1 hours').replace(/(\d+)m/, '$1 minutes');
}

export interface ShootTimerProps {
  readonly detail: ProAssignmentDetail;
  readonly job: JobProjection;
}

/** The big elapsed timer since the billing start, with the booked duration under it. */
export function ShootTimer({ detail, job }: ShootTimerProps) {
  const now = useNow(TIMER_TICK_MS);
  const billing = job.timing.billingStartsAt;
  const elapsedMs = billing ? now.getTime() - Date.parse(billing) : 0;
  // Before the scheduled start the clock has not begun (ADR-0013 D6): count down to it instead.
  const beforeStart = elapsedMs < 0;
  const elapsed = beforeStart ? formatElapsed(-elapsedMs) : formatElapsed(elapsedMs);
  const heading = beforeStart
    ? 'Billing starts in'
    : job.stage === 'IN_PROGRESS'
      ? 'Shoot time'
      : 'Since the start';
  const extension =
    detail.approvedExtensionHours > 0
      ? ` + ${formatHours(detail.approvedExtensionHours)} extension`
      : '';

  return (
    <Card className="items-center gap-1" testID="shoot-timer">
      <Text variant="micro" tone="tertiary">
        {heading}
      </Text>
      <Text variant="display" tabular accessibilityLabel={`${heading} ${spoken(elapsed)}`}>
        {elapsed}
      </Text>
      <Text tone="secondary">
        Booked {formatHours(detail.scheduledHours)}
        {extension}
      </Text>
      {billing ? (
        <Text variant="caption" tone="tertiary">
          {!beforeStart
            ? `Billing from ${formatClock(billing)}`
            : `Billing starts at ${formatClock(billing)}, the scheduled start`}
          {job.checkedInAt ? ` · checked in ${formatClock(job.checkedInAt)}` : ''}
        </Text>
      ) : null}
    </Card>
  );
}
