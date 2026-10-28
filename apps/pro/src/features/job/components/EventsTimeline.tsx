import type { ProAssignmentDetail } from '@clickco/contracts';
import { Card, ListRow, Section } from '@clickco/ui';
import { timelineEntries } from '../lib/labels';
import { formatAt } from '../lib/timing';

/** A short, light activity list from the check-in/out and `detail.events`. */
export function EventsTimeline({ detail, now }: { detail: ProAssignmentDetail; now: Date }) {
  const entries = timelineEntries(detail);
  if (entries.length === 0) return null;
  return (
    <Section title="Activity">
      <Card padding="list">
        {entries.map((entry, i) => (
          <ListRow
            key={entry.key}
            title={entry.title}
            subtitle={entry.subtitle}
            value={formatAt(entry.at, now)}
            divider={i < entries.length - 1}
          />
        ))}
      </Card>
    </Section>
  );
}
