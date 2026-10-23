import {
  Button,
  Card,
  EmptyState,
  Icon,
  Screen,
  Skeleton,
  StatusBadge,
  Text,
  TIER_LABEL,
} from '@clickco/ui';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import { Share, View } from 'react-native';
import { awaitingPayment, journey, statusPresentation } from '@/shared/booking-status';
import { categoryLabel } from '@/shared/catalogue';
import { userMessage } from '@/shared/errors';
import { formatShootWindow } from '@/shared/format/datetime';
import { useBooking } from '../hooks';
import { venueArea } from '../lib/venue';
import { JourneyTimeline } from './JourneyTimeline';

export interface ConfirmedViewProps {
  readonly bookingId: string;
  readonly onViewBooking: (bookingId: string) => void;
}

/** Screen 5 — "You're booked." Amber success, the reference, and what happens next. */
export function ConfirmedView({ bookingId, onViewBooking }: ConfirmedViewProps) {
  const detail = useBooking(bookingId);

  if (detail.isPending) {
    return (
      <Screen>
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </Screen>
    );
  }
  if (detail.isError) {
    return (
      <Screen>
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load your booking"
          body={userMessage(detail.error)}
          action={{ label: 'Try again', onPress: () => void detail.refetch() }}
        />
      </Screen>
    );
  }

  const { booking } = detail.data;
  const when = formatShootWindow(booking.scheduledStart, booking.scheduledHours);
  const what = `${TIER_LABEL[booking.tier]} · ${categoryLabel(booking.categoryCode)}`;
  const where = venueArea(booking.venueAddress, booking.cityName);
  const pending = awaitingPayment(booking.status);
  const share = () =>
    void Share.share({
      message: `Clickco booking ${booking.reference}: ${what}, ${when}, ${where}.`,
    }).catch(() => undefined);

  return (
    <Screen
      footer={
        <>
          <Button
            label="View booking"
            onPress={() => onViewBooking(booking.id)}
            testID="view-booking"
          />
          <Button label="Share details" variant="secondary" onPress={share} />
        </>
      }
    >
      <View className="items-center gap-3 pt-10">
        <Icon icon={CircleCheck} tone={pending ? 'warning' : 'accent'} size="large" />
        <Text variant="display" align="center" testID="confirmed-title">
          {pending ? 'Almost there.' : "You're booked."}
        </Text>
        <Text tone="secondary" align="center">
          Booking ID #{booking.reference}
        </Text>
        {pending ? (
          <StatusBadge label={statusPresentation(booking.status).label} tone="warning" />
        ) : null}
      </View>

      <Card className="gap-1">
        <Text variant="bodyStrong">{what}</Text>
        <Text tone="secondary" tabular>
          {when}
        </Text>
        <Text tone="secondary">{where}</Text>
      </Card>

      <Card>
        <JourneyTimeline steps={journey(booking.status)} />
      </Card>

      <Card>
        <Text variant="caption" tone="secondary">
          {pending
            ? 'Finish the payment to lock in your photographer.'
            : "We'll assign your photographer within 2 hours."}
        </Text>
      </Card>
    </Screen>
  );
}
