import { EmptyState, palette, Reveal, Screen, SegmentedControl, Skeleton, Text } from '@clickco/ui';
import CalendarCheck from 'lucide-react-native/icons/calendar-check';
import CircleAlert from 'lucide-react-native/icons/circle-alert';
import { useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { splitBookings } from '@/shared/booking-status';
import { userMessage } from '@/shared/errors';
import { useBookings } from '../hooks';
import { BookingCard } from './BookingCard';

type Segment = 'upcoming' | 'past';

export interface BookingsListViewProps {
  readonly onOpen: (bookingId: string) => void;
  readonly onBook: () => void;
}

/** Screen 6 — Upcoming / Past, each card with its status badge. */
export function BookingsListView({ onOpen, onBook }: BookingsListViewProps) {
  const [segment, setSegment] = useState<Segment>('upcoming');
  const bookings = useBookings();
  const split = splitBookings(bookings.data ?? []);
  const shown = split[segment];
  const count = (n: number) => (bookings.data ? ` (${n})` : '');

  return (
    <Screen
      header={
        <View className="gap-4 pb-2">
          <Text variant="display" accessibilityRole="header">
            Bookings
          </Text>
          <SegmentedControl
            accessibilityLabel="Show bookings"
            value={segment}
            onChange={setSegment}
            segments={[
              {
                value: 'upcoming',
                label: `Upcoming${count(split.upcoming.length)}`,
                testID: 'segment-upcoming',
              },
              { value: 'past', label: `Past${count(split.past.length)}`, testID: 'segment-past' },
            ]}
          />
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={bookings.isRefetching}
          onRefresh={() => void bookings.refetch()}
          tintColor={palette.text.secondary}
          colors={[palette.text.primary]}
        />
      }
    >
      {bookings.isPending ? (
        <View className="gap-4">
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </View>
      ) : bookings.isError ? (
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load your bookings"
          body={userMessage(bookings.error)}
          action={{ label: 'Try again', onPress: () => void bookings.refetch() }}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          key={segment}
          icon={CalendarCheck}
          title={segment === 'upcoming' ? 'No upcoming shoots' : 'No past shoots yet'}
          body={
            segment === 'upcoming'
              ? 'Book a photographer and your shoot will show up here.'
              : 'Delivered and cancelled shoots appear here.'
          }
          action={{ label: 'Book a shoot', onPress: onBook }}
        />
      ) : (
        <View key={segment} className="gap-4">
          {shown.map((booking, i) => (
            <Reveal key={booking.id} index={i}>
              <BookingCard booking={booking} onPress={() => onOpen(booking.id)} />
            </Reveal>
          ))}
        </View>
      )}
    </Screen>
  );
}
