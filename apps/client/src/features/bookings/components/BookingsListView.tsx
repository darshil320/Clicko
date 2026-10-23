import { color } from '@clickco/design-tokens';
import { Chip, EmptyState, Screen, Skeleton, Text } from '@clickco/ui';
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

  return (
    <Screen
      header={
        <View className="gap-3 pb-2">
          <Text variant="h1" accessibilityRole="header">
            Bookings
          </Text>
          <View className="flex-row gap-2" accessibilityRole="tablist">
            <Chip
              label={`Upcoming${bookings.data ? ` (${split.upcoming.length})` : ''}`}
              selected={segment === 'upcoming'}
              onPress={() => setSegment('upcoming')}
              testID="segment-upcoming"
            />
            <Chip
              label={`Past${bookings.data ? ` (${split.past.length})` : ''}`}
              selected={segment === 'past'}
              onPress={() => setSegment('past')}
              testID="segment-past"
            />
          </View>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={bookings.isRefetching}
          onRefresh={() => void bookings.refetch()}
          tintColor={color.text.secondary}
        />
      }
    >
      {bookings.isPending ? (
        <>
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </>
      ) : bookings.isError ? (
        <EmptyState
          icon={CircleAlert}
          title="We couldn't load your bookings"
          body={userMessage(bookings.error)}
          action={{ label: 'Try again', onPress: () => void bookings.refetch() }}
        />
      ) : shown.length === 0 ? (
        <EmptyState
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
        shown.map((booking) => (
          <BookingCard key={booking.id} booking={booking} onPress={() => onOpen(booking.id)} />
        ))
      )}
    </Screen>
  );
}
