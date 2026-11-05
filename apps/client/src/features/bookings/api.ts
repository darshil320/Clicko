import type { CancelBookingBody } from '@clickco/contracts';
import { api } from '@/shared/api';

/** What cancelling now returns under the T&C §3 ladder, or why it is not possible (ADR-0031). */
export const fetchCancellationQuote = (bookingId: string) =>
  api.bookings.cancellationQuote(bookingId);

/** Cancels against the confirmed refund; one Idempotency-Key per intent (the booking key ring). */
export const cancelBooking = (bookingId: string, body: CancelBookingBody, idempotencyKey: string) =>
  api.bookings.cancel(bookingId, { idempotencyKey }, body);

/** Refunds (once approved) and credits on one of the caller's bookings (ADR-0027 D5). */
export const fetchBookingMoney = (bookingId: string) => api.bookings.money(bookingId);
