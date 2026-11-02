import { EmptyState } from '@clickco/ui';
import SearchX from 'lucide-react-native/icons/search-x';

/** A booking id that can never load (no id, 404, malformed): say so and offer the way back. */
export function BookingMissing({ onBackToBookings }: { onBackToBookings: () => void }) {
  return (
    <EmptyState
      icon={SearchX}
      title="We can't find this booking"
      body="It may have been removed, or it was made from another account."
      action={{ label: 'Go to bookings', onPress: onBackToBookings }}
      testID="booking-missing"
    />
  );
}
