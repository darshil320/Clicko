import type { BookingSummary } from '@clickco/contracts';
import { Button, Card, IconTile, StatusBadge, Text, TIER_LABEL, TierBadge } from '@clickco/ui';
import { View } from 'react-native';
import { statusPresentation } from '@/shared/booking-status';
import { categoryLabel } from '@/shared/catalogue';
import { categoryIcon } from '@/shared/category-icons';
import { formatDayMonth, formatShootWindow } from '@/shared/format/datetime';
import { venueArea } from '../lib/venue';

export function BookingCard({
  booking,
  onPress,
}: {
  booking: BookingSummary;
  onPress: () => void;
}) {
  const status = statusPresentation(booking.status);
  return (
    <Card
      onPress={onPress}
      accessibilityLabel={`${categoryLabel(booking.categoryCode)} shoot, ${status.label}, ${formatShootWindow(
        booking.scheduledStart,
        booking.scheduledHours,
      )}`}
      className="gap-4"
      testID={`booking-${booking.reference}`}
    >
      <View className="flex-row items-center justify-between gap-2">
        <StatusBadge label={status.label} tone={status.tone} />
        <TierBadge tier={booking.tier} />
      </View>
      <View className="flex-row items-center gap-4">
        <IconTile icon={categoryIcon(booking.categoryCode)} size="md" shape="circle" />
        <View className="flex-1 gap-1">
          <Text variant="h3">{categoryLabel(booking.categoryCode)} shoot</Text>
          <Text tone="secondary" tabular>
            {formatShootWindow(booking.scheduledStart, booking.scheduledHours)}
          </Text>
        </View>
      </View>
      <View className="flex-row items-center justify-between gap-2 border-t border-border-subtle pt-3">
        <Text variant="caption" tone="tertiary" className="flex-1" numberOfLines={1}>
          {venueArea(booking.venueAddress, booking.cityName)}
        </Text>
        <Text variant="caption" tone="tertiary" tabular>
          {booking.reference}
        </Text>
      </View>
    </Card>
  );
}

/** Home's "Book again": the latest delivered shoot, with a one-tap rebook. */
export function BookAgainCard({
  booking,
  onRebook,
}: {
  booking: BookingSummary;
  onRebook: () => void;
}) {
  return (
    <Card className="flex-row items-center gap-4">
      <IconTile icon={categoryIcon(booking.categoryCode)} size="md" shape="circle" />
      <View className="flex-1 gap-1">
        <Text variant="bodyStrong">{categoryLabel(booking.categoryCode)} shoot</Text>
        <Text variant="caption" tone="secondary" tabular>
          {formatDayMonth(new Date(booking.scheduledStart))} · {TIER_LABEL[booking.tier]}
        </Text>
      </View>
      <Button label="Rebook" variant="secondary" size="compact" onPress={onRebook} />
    </Card>
  );
}
