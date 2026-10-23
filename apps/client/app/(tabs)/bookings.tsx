import { useRouter } from 'expo-router';
import { BookingsListView } from '@/features/bookings';

/** Screen 6 — Bookings. */
export default function BookingsRoute() {
  const router = useRouter();
  return (
    <BookingsListView
      onOpen={(id) => router.push({ pathname: '/bookings/[id]', params: { id } })}
      onBook={() => router.navigate('/')}
    />
  );
}
