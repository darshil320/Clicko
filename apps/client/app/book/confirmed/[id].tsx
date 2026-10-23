import { useLocalSearchParams, useRouter } from 'expo-router';
import { ConfirmedView } from '@/features/bookings';

/** Screen 5 — Booking confirmed. Leaving it clears the booking flow off the stack. */
export default function ConfirmedRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <ConfirmedView
      bookingId={id}
      onViewBooking={(bookingId) => {
        router.dismissAll();
        router.push({ pathname: '/bookings/[id]', params: { id: bookingId } });
      }}
    />
  );
}
