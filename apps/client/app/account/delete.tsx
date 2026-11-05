import { useRouter } from 'expo-router';
import { DeleteAccountView } from '@/features/account';

/** Profile → "Delete account" (ADR-0030). On success the session ends and sign-in says so. */
export default function DeleteAccountRoute() {
  const router = useRouter();
  return (
    <DeleteAccountView
      onOpenBooking={(bookingId) =>
        router.push({ pathname: '/bookings/[id]', params: { id: bookingId } })
      }
      onKeep={() => router.back()}
    />
  );
}
