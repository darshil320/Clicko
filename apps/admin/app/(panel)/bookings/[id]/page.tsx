import type { Metadata } from 'next';
import { BookingPage } from '../../../../src/features/bookings/booking-page';

export const metadata: Metadata = { title: 'Booking' };

export default async function BookingRoute({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BookingPage bookingId={id} />;
}
