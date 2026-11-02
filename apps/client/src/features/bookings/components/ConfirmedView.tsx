import {
  Button,
  Card,
  ErrorState,
  IconTile,
  Screen,
  Section,
  Skeleton,
  StatusBadge,
  Text,
  TIER_LABEL,
} from '@clickco/ui';
import Check from 'lucide-react-native/icons/check';
import Hourglass from 'lucide-react-native/icons/hourglass';
import { Share, View } from 'react-native';
import { awaitingPayment, journey, statusPresentation } from '@/shared/booking-status';
import { categoryLabel } from '@/shared/catalogue';
import { isNotFound } from '@/shared/errors';
import { formatShootWindow } from '@/shared/format/datetime';
import { screenState } from '@/shared/screen-state';
import { useBooking } from '../hooks';
import { venueArea } from '../lib/venue';
import { BookingMissing } from './BookingMissing';
import { JourneyTimeline } from './JourneyTimeline';

export interface ConfirmedViewProps {
  readonly bookingId: string | undefined;
  readonly onViewBooking: (bookingId: string) => void;
  /** The way out when the booking does not exist (or is not this client's). */
  readonly onBackToBookings: () => void;
}

/** Screen 5 — "You're booked." A soft amber success mark, the reference, and what happens next. */
export function ConfirmedView({ bookingId, onViewBooking, onBackToBookings }: ConfirmedViewProps) {
  const detail = useBooking(bookingId);
  const state = screenState(detail);

  if (!bookingId || (detail.data === undefined && isNotFound(detail.error))) {
    return (
      <Screen>
        <BookingMissing onBackToBookings={onBackToBookings} />
      </Screen>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Screen>
        <View className="items-center gap-4 pt-12">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-10 w-48" />
        </View>
        <Skeleton className="h-32 w-full rounded-lg" />
      </Screen>
    );
  }
  if (state.kind === 'offline' || state.kind === 'error') {
    return (
      <Screen>
        <ErrorState
          offline={state.kind === 'offline'}
          title="We couldn't load your booking"
          body={state.message}
          retrying={state.retrying}
          onRetry={() => void detail.refetch()}
        />
      </Screen>
    );
  }

  const { booking } = state.data;
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
      <View className="items-center gap-4 pt-12 pb-2">
        <IconTile
          icon={pending ? Hourglass : Check}
          tone={pending ? 'warning' : 'accentSubtle'}
          size="lg"
          shape="circle"
        />
        <View className="items-center gap-2">
          <Text variant="display" align="center" testID="confirmed-title">
            {pending ? 'Almost there.' : "You're booked."}
          </Text>
          <Text tone="secondary" align="center" tabular>
            Booking ID #{booking.reference}
          </Text>
        </View>
        {pending ? (
          <View className="items-center">
            <StatusBadge label={statusPresentation(booking.status).label} tone="warning" />
          </View>
        ) : null}
      </View>

      <Card className="gap-2">
        <Text variant="h3">{what}</Text>
        <Text tone="secondary" tabular>
          {when}
        </Text>
        <Text tone="secondary">{where}</Text>
      </Card>

      <Section
        title="What happens next"
        subtitle={
          pending
            ? 'Finish the payment to lock in your photographer.'
            : "We'll assign your photographer within 2 hours."
        }
      >
        <Card>
          <JourneyTimeline steps={journey(booking.status)} />
        </Card>
      </Section>
    </Screen>
  );
}
