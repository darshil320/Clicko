import { useLocalSearchParams, useRouter } from 'expo-router';
import { BookingDetailView } from '@/features/bookings';

/** Booking detail — status + timeline; Screens 7–10 grow out of this view as dispatch and delivery land. */
export default function BookingRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <BookingDetailView
      bookingId={id}
      onPay={(bookingId) => router.push({ pathname: '/book/pay/[id]', params: { id: bookingId } })}
    />
  );
}
