import type { PlanTier } from '@clickco/contracts';
import { Card, Checkbox, Section } from '@clickco/ui';
import { useState } from 'react';
import { checklistFor } from '../lib/labels';

/** Pre-shoot checklist for the tier (doc 01 screen 13). Local state only — nothing is sent. */
export function Checklist({ tier }: { tier: PlanTier }) {
  const items = checklistFor(tier);
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = (key: string, checked: boolean) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <Section
      title="Before you leave"
      subtitle={`${done.size} of ${items.length} done · just a reminder, not sent anywhere`}
    >
      <Card padding="list">
        {items.map((item) => (
          <Checkbox
            key={item.key}
            checked={done.has(item.key)}
            onChange={(checked) => toggle(item.key, checked)}
            label={item.label}
            accessibilityLabel={item.label}
            testID={`checklist-${item.key}`}
          />
        ))}
      </Card>
    </Section>
  );
}
