import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BookingsBoard } from '../../../src/features/bookings/board';

export const metadata: Metadata = { title: 'Bookings' };

export default function BookingsPage() {
  return (
    <Suspense>
      <BookingsBoard />
    </Suspense>
  );
}
