import type { BookingSummary } from '@clickco/contracts';
import { Text } from '@clickco/ui';
import { View } from 'react-native';
import { splitBookings } from '@/shared/booking-status';
import { useBookings } from '../hooks';
import { BookAgainCard } from './BookingCard';

/** Home's "Book again" — the latest delivered shoot. Renders nothing until there is one. */
export function BookAgain({ onRebook }: { onRebook: (booking: BookingSummary) => void }) {
  const bookings = useBookings();
  const last = splitBookings(bookings.data ?? []).past.find(
    (b) => b.status === 'DELIVERED' || b.status === 'CLOSED',
  );
  if (!last) return null;
  return (
    <View className="gap-3">
      <Text variant="h3" accessibilityRole="header">
        Book again
      </Text>
      <BookAgainCard booking={last} onRebook={() => onRebook(last)} />
    </View>
  );
}
