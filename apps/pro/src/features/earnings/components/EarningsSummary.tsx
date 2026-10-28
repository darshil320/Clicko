import type { ProEarnings } from '@clickco/contracts';
import { Card, cx, Icon, Text } from '@clickco/ui';
import Info from 'lucide-react-native/icons/info';
import { View } from 'react-native';
import { formatDateTime } from '@/shared/format/datetime';
import { rupees } from '@/shared/format/money';

function Stat({
  label,
  spokenLabel = label,
  value,
  divider,
}: {
  label: string;
  /** The full words for screen readers when the visible label is shortened to fit. */
  spokenLabel?: string;
  value: string;
  divider?: boolean;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${spokenLabel} ${value}`}
      className={cx('flex-1 gap-1 px-3', divider && 'border-l border-border-subtle')}
    >
      <Text variant="micro" tone="tertiary" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="h3" tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </View>
  );
}

/**
 * Doc 01 screen 15's big number and summary row. Every amount is an expected gross payout
 * (`basis: EXPECTED`): there are no payout batches or TDS yet, so none are shown or guessed.
 */
export function EarningsSummary({ earnings }: { earnings: ProEarnings }) {
  const month = rupees(earnings.monthPaise);
  return (
    <View className="gap-4">
      <View className="gap-1" accessible accessibilityLabel={`This month ${month}`}>
        <Text variant="micro" tone="tertiary">
          This month
        </Text>
        <Text variant="display" tabular testID="earnings-month">
          {month}
        </Text>
        <Text variant="caption" tone="tertiary" tabular>
          Updated {formatDateTime(earnings.asOf)}
        </Text>
      </View>
      <Card padding="compact" className="flex-row">
        <Stat label="Today" value={rupees(earnings.todayPaise)} />
        <Stat label="This week" value={rupees(earnings.weekPaise)} divider />
        <Stat
          label="Pending"
          spokenLabel="Pending payout"
          value={rupees(earnings.pendingPayoutPaise)}
          divider
        />
      </Card>
      <View className="flex-row gap-3">
        <Icon icon={Info} size="small" tone="tertiary" />
        <Text variant="caption" tone="secondary" className="flex-1">
          These are expected earnings from shoots you have completed. Payout batches and TDS will
          appear here once payouts start.
        </Text>
      </View>
    </View>
  );
}
