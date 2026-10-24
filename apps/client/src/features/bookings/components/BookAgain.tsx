import type { BookingSummary } from '@clickco/contracts';
import { Section } from '@clickco/ui';
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
    <Section title="Book again">
      <BookAgainCard booking={last} onRebook={() => onRebook(last)} />
    </Section>
  );
}
