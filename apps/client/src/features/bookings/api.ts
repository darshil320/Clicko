import { api } from '@/shared/api';

export const cancelBooking = (bookingId: string, idempotencyKey: string) =>
  api.bookings.cancel(bookingId, { idempotencyKey });

/** Refunds (once approved) and credits on one of the caller's bookings (ADR-0027 D5). */
export const fetchBookingMoney = (bookingId: string) => api.bookings.money(bookingId);
