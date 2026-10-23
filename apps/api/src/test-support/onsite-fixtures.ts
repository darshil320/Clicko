import { type LatLng, pointAt } from '../infra/db/seeds/geo-offset';
import { TokenService } from '../modules/auth/token.service';
import { drainOutbox } from './dispatch-fixtures';
import type { E2eApp, Json } from './e2e-app';
import { cityCentre } from './photographer-fixtures';

/** On-site test helpers (ADR-0013). */

export const SURAT_CENTRE = cityCentre('Surat');

/** A fix `km` from a point on a compass bearing, accuracy 12 m. */
export function fixAt(km: number, bearing: number, from: LatLng = SURAT_CENTRE, extra: Json = {}) {
  const p = pointAt(from, km, bearing);
  return { lat: p.lat, lng: p.lng, accuracyM: 12, ...extra };
}

let keySeq = 0;
export const idemKey = (label: string): string =>
  `onsite-${label.replace(/[^A-Za-z0-9.-]/g, '-')}-${String(++keySeq).padStart(5, '0')}`;

/** Sessions minted directly (no OTP round trips): clock jumps of days outlive a 15-minute token. */
export async function tokenFor(
  e2e: E2eApp,
  kind: 'USER' | 'PHOTOGRAPHER',
  id: string,
): Promise<string> {
  return (await e2e.get(TokenService).issue({ kind, id }, null)).accessToken;
}

export async function insertClient(e2e: E2eApp, phone: string): Promise<string> {
  const [row] = await e2e.db.sql<{ id: string }[]>`
    INSERT INTO users (phone_e164, full_name) VALUES (${phone}, 'Rohan Shah') RETURNING id`;
  if (!row) throw new Error('insertClient: no row');
  return row.id;
}

/** Set the clock to an absolute instant (forward only). */
export function setNow(e2e: E2eApp, when: Date): void {
  const delta = when.getTime() - e2e.now().getTime();
  if (delta < 0) throw new Error(`setNow: cannot go back ${-delta} ms`);
  e2e.advance(delta);
}

/**
 * Professional · Food in Surat (395007), paid through the dev simulator (development app only),
 * drained to DISPATCHING. Returns the BookingSummary JSON.
 */
export async function bookAndPay(
  e2e: E2eApp,
  userId: string,
  start: Date,
  hours = 2,
): Promise<Json> {
  const t = await tokenFor(e2e, 'USER', userId);
  const created = await e2e.call('POST', '/bookings', {
    token: t,
    idempotencyKey: idemKey('create'),
    body: {
      tier: 'PROFESSIONAL',
      categoryCode: 'FOOD',
      pincode: '395007',
      scheduledStart: start.toISOString(),
      hours,
      venueAddress: '4 Athwalines, Surat',
      booker: { name: 'Rohan Shah', phone: '+919700000888' },
      modelReleaseConsent: false,
      acceptedTermsVersion: '2.0',
    },
  });
  if (created.status !== 201) throw new Error(`bookAndPay: create ${JSON.stringify(created.json)}`);
  const booking = created.json.data.booking as Json;
  const pay = await e2e.call('POST', `/bookings/${booking.id}/pay`, {
    token: t,
    idempotencyKey: idemKey('pay'),
  });
  const sim = await e2e.call('POST', `/dev/payments/${pay.json.data.paymentId}/simulate`, {
    body: { outcome: 'CAPTURED' },
  });
  if (sim.json.data?.outcome !== 'APPLIED')
    throw new Error(`bookAndPay: ${JSON.stringify(sim.json)}`);
  await drainOutbox(e2e);
  return booking;
}

/** The photographer accepts their offer on `bookingId`; returns the assignment id. */
export async function acceptOffer(e2e: E2eApp, proId: string, bookingId: string): Promise<string> {
  const t = await tokenFor(e2e, 'PHOTOGRAPHER', proId);
  const offers = await e2e.call('GET', '/pro/offers', { token: t });
  const offer = (offers.json.data as Json[]).find((o) => o.bookingId === bookingId);
  if (!offer)
    throw new Error(`acceptOffer: no offer for ${bookingId}: ${JSON.stringify(offers.json)}`);
  const accepted = await e2e.call('POST', `/pro/offers/${offer.attemptId}/accept`, {
    token: t,
    idempotencyKey: idemKey('accept'),
  });
  if (accepted.status !== 200) throw new Error(`acceptOffer: ${JSON.stringify(accepted.json)}`);
  await drainOutbox(e2e);
  return accepted.json.data.assignmentId as string;
}

/** POST /pro/assignments/:id/<action> as the photographer, with a fresh idempotency key. */
export async function proAction(
  e2e: E2eApp,
  proId: string,
  assignmentId: string,
  action: string,
  body?: unknown,
) {
  return e2e.call('POST', `/pro/assignments/${assignmentId}/${action}`, {
    token: await tokenFor(e2e, 'PHOTOGRAPHER', proId),
    idempotencyKey: idemKey(action),
    ...(body === undefined ? {} : { body }),
  });
}
