import type { CreateBookingRequest } from '@clickco/contracts';
import { PaymentFlowService } from '../modules/checkout/payment-flow.service';
import { PAYMENT_GATEWAY } from '../modules/payments/gateways/payment-gateway.port';
import { SandboxGateway } from '../modules/payments/gateways/sandbox.gateway';
import { bookingRequest, createQuotedBooking } from './booking-fixtures';
import type { E2eApp } from './e2e-app';

/** A CONFIRMED booking made through the real pay → signed sandbox webhook path. */
export async function confirmedBooking(
  e2e: E2eApp,
  userId: string,
  start: Date,
  overrides: Partial<CreateBookingRequest> = {},
): Promise<{ bookingId: string; paymentId: string }> {
  const req = bookingRequest(overrides, start.toISOString());
  const { view } = await createQuotedBooking(e2e.db.sql, userId, e2e.now(), req);
  const flow = e2e.get(PaymentFlowService);
  const pay = await flow.pay(userId, view.id);
  const gateway = e2e.get(PAYMENT_GATEWAY);
  if (!(gateway instanceof SandboxGateway)) throw new Error('confirmedBooking needs the sandbox');
  const hook = gateway.buildWebhook({
    providerOrderId: pay.providerOrderId,
    amountPaise: BigInt(pay.amountPaise),
    event: pay.authorizeOnly ? 'payment.authorized' : 'payment.captured',
  });
  const outcome = await flow.handleWebhook({
    provider: gateway.routeSlug,
    rawBody: hook.rawBody,
    signature: hook.signature,
    eventId: hook.eventId,
  });
  if (outcome !== 'APPLIED') throw new Error(`confirmedBooking: webhook ${outcome}`);
  return { bookingId: view.id, paymentId: pay.paymentId };
}

export async function bookingStatus(e2e: E2eApp, bookingId: string): Promise<string> {
  const [row] = await e2e.db.sql<{ status: string }[]>`
    SELECT status FROM bookings WHERE id = ${bookingId}`;
  return row?.status ?? 'MISSING';
}

export interface RoundRow {
  id: string;
  wave: number;
  radius_km: number;
  candidate_count: number;
  window_seconds: number;
  is_broadcast: boolean;
  ended_at: Date | null;
  outcome: string | null;
}

export const roundsOf = (e2e: E2eApp, bookingId: string) =>
  e2e.db.sql<RoundRow[]>`
    SELECT id, wave, radius_km::float8 AS radius_km, candidate_count, window_seconds, is_broadcast,
           ended_at, outcome
    FROM dispatch_rounds WHERE booking_id = ${bookingId} ORDER BY wave`;

export interface AttemptRow {
  id: string;
  wave: number;
  photographer_id: string;
  outcome: string;
  rank_score: number;
  offered_payout_paise: string;
  expires_at: Date;
  decline_reason: string | null;
}

export const attemptsOf = (e2e: E2eApp, bookingId: string) =>
  e2e.db.sql<AttemptRow[]>`
    SELECT a.id, r.wave, a.photographer_id, a.outcome, a.rank_score::float8 AS rank_score,
           a.offered_payout_paise, a.expires_at, a.decline_reason
    FROM dispatch_attempts a JOIN dispatch_rounds r ON r.id = a.round_id
    WHERE a.booking_id = ${bookingId} ORDER BY r.wave, a.rank_score DESC, a.id`;

export const eventsOf = async (e2e: E2eApp, bookingId: string): Promise<string[]> =>
  (
    await e2e.db.sql<{ event_type: string }[]>`
      SELECT event_type FROM domain_events WHERE aggregate_id = ${bookingId} ORDER BY id`
  ).map((r) => r.event_type);

export const expectedPayout = async (e2e: E2eApp, bookingId: string): Promise<string> => {
  const [row] = await e2e.db.sql<{ p: string }[]>`
    SELECT expected_payout_paise AS p FROM booking_price_snapshots
    WHERE booking_id = ${bookingId} AND sequence = 1`;
  return row?.p ?? '';
};

/** Publishes until the outbox is drained (subscribers append follow-up events). */
export async function drainOutbox(e2e: E2eApp): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const r = await e2e.publish();
    if (r.published === 0 && r.failed === 0) return;
  }
  throw new Error('drainOutbox: outbox did not settle');
}
