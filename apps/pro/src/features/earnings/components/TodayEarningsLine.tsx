import { Text } from '@clickco/ui';
import { View } from 'react-native';
import { rupees } from '@/shared/format/money';
import { useEarnings } from '../hooks';

/**
 * The Jobs tab's header line (doc 01 screen 11: today's earnings). Nothing at all while loading
 * or on error — the tab's own content matters more than a missing total.
 */
export function TodayEarningsLine() {
  const earnings = useEarnings();
  if (earnings.isError || earnings.data === undefined) return null;
  const today = rupees(earnings.data.todayPaise);
  const week = rupees(earnings.data.weekPaise);
  return (
    <View
      accessible
      accessibilityLabel={`Expected earnings: today ${today}, this week ${week}`}
      className="flex-row flex-wrap items-baseline gap-x-2"
      testID="today-earnings"
    >
      <Text variant="caption" tone="secondary">
        Today
      </Text>
      <Text variant="bodyStrong" tabular>
        {today}
      </Text>
      <Text variant="caption" tone="tertiary">
        ·
      </Text>
      <Text variant="caption" tone="secondary">
        This week
      </Text>
      <Text variant="bodyStrong" tabular>
        {week}
      </Text>
    </View>
  );
}
