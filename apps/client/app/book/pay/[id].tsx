import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { PaymentView } from '@/features/booking';

/** Payment — sandbox in development; Razorpay checkout before launch. */
export default function PayRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const onConfirmed = useCallback(
    (bookingId: string) =>
      router.replace({ pathname: '/book/confirmed/[id]', params: { id: bookingId } }),
    [router],
  );
  return (
    <PaymentView
      bookingId={id}
      onConfirmed={onConfirmed}
      onViewBooking={(bookingId) =>
        router.push({ pathname: '/bookings/[id]', params: { id: bookingId } })
      }
    />
  );
}
