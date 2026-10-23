import type { SimulatedOutcome } from '@clickco/api-client';
import type { CreateBookingBody, QuoteRequestBody } from '@clickco/contracts';
import { api } from '@/shared/api';
import { assertDevBuild } from '@/shared/config';

export const fetchQuote = (body: QuoteRequestBody) => api.pricing.quote(body);

export const createBooking = (body: CreateBookingBody, idempotencyKey: string) =>
  api.bookings.create(body, { idempotencyKey });

export const openPayment = (bookingId: string, idempotencyKey: string) =>
  api.bookings.pay(bookingId, { idempotencyKey });

/** Development only: the sandbox gateway "pays" through the real webhook path. */
export const simulatePayment = async (paymentId: string, outcome: SimulatedOutcome) => {
  assertDevBuild('Simulating a payment');
  return api.dev.simulatePayment(paymentId, outcome);
};
