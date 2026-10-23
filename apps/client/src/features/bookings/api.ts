import { api } from '@/shared/api';

export const cancelBooking = (bookingId: string, idempotencyKey: string) =>
  api.bookings.cancel(bookingId, { idempotencyKey });
