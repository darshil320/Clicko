import type { ProAssignmentDetail } from '@clickco/contracts';
import { Card, ListRow, StatusBadge, Text, TierBadge } from '@clickco/ui';
import { View } from 'react-native';
import { categoryLabel } from '@/shared/catalogue';
import { formatHours, formatShootWindow } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';
import { stageBadge } from '../lib/labels';
import type { JobProjection } from '../lib/project';

/** The state badge and tier, at the very top of every stage. */
export function StageBadgeRow({
  detail,
  job,
}: {
  detail: ProAssignmentDetail;
  job: JobProjection;
}) {
  const badge = stageBadge(job);
  return (
    <View className="flex-row items-center justify-between gap-3" accessibilityLiveRegion="polite">
      <StatusBadge label={badge.label} tone={badge.tone} />
      <TierBadge tier={detail.tier} />
    </View>
  );
}

/** Reference, category, shoot window, payout (large tabular), client and special requirements. */
export function JobHeader({ detail }: { detail: ProAssignmentDetail }) {
  const payout = rupees(detail.payoutPaise);
  return (
    <View className="gap-3">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="h1" accessibilityRole="header">
            {categoryLabel(detail.categoryCode)} shoot
          </Text>
          <Text variant="caption" tone="tertiary" tabular selectable>
            Booking {detail.bookingReference}
          </Text>
        </View>
        <Text variant="h1" tabular accessibilityLabel={`Payout ${payout}`}>
          {payout}
        </Text>
      </View>
      <Card padding="list">
        <ListRow
          title="When"
          value={formatShootWindow(detail.scheduledStart, detail.scheduledHours)}
          divider
        />
        <ListRow title="Booked" value={formatHours(detail.scheduledHours)} divider />
        <ListRow title="Client" value={detail.clientDisplayName} />
      </Card>
      {detail.specialRequirements ? (
        <Card className="gap-1">
          <Text variant="micro" tone="tertiary">
            Special requirements
          </Text>
          <Text>{detail.specialRequirements}</Text>
        </Card>
      ) : null}
    </View>
  );
}
