import { Uuid } from '@clickco/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { NewTicketView } from '@/features/care';

/** "Get help": a support ticket. `bookingId` comes from a booking's "Get help", so it is validated. */
export default function NewTicketRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const bookingId = Uuid.safeParse(params.bookingId);
  return (
    <NewTicketView
      bookingId={bookingId.success ? bookingId.data : undefined}
      onSeeTickets={() => {
        // The confirmation leaves the stack, so Back from the Help tab never returns to it.
        router.dismissAll();
        router.navigate('/help');
      }}
    />
  );
}
