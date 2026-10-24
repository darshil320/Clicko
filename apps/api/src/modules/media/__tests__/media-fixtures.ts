import { createHash } from 'node:crypto';
import type { BookingStatus } from '@clickco/contracts';
import { insertUser } from '../../../test-support/booking-fixtures';
import { confirmedBooking, drainOutbox } from '../../../test-support/dispatch-fixtures';
import type { E2eApp } from '../../../test-support/e2e-app';
import { BookingsService } from '../../bookings/bookings.service';

export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export const md5 = (b: Buffer): string => createHash('md5').update(b).digest('hex');

/** Deterministic pseudo-random bytes (a stand-in for a RAW file). */
export function fakeBytes(size: number, seed: number): Buffer {
  const b = Buffer.alloc(size);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < size; i++) {
    x = (x * 1_103_515_245 + 12_345) >>> 0;
    b[i] = x >>> 24;
  }
  return b;
}

/** First bytes of real files, so the content check (security review M8) accepts the fakes. */
export const SIGNATURES = {
  CR3: Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypcrx ', 'latin1')]),
  JPEG: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
} as const;

/** `fakeBytes` that start with a file signature (same size). */
export function fakeFile(size: number, seed: number, signature: Buffer): Buffer {
  const b = fakeBytes(size, seed);
  signature.copy(b, 0);
  return b;
}

const WALK: readonly BookingStatus[] = ['EN_ROUTE', 'CHECKED_IN', 'IN_PROGRESS', 'CHECKED_OUT'];

/**
 * A booking walked to CHECKED_OUT the legal way: book → pay (signed sandbox webhook) → dispatch →
 * the photographer accepts their offer over HTTP (a real assignment row) → BookingsService.transition
 * ASSIGNED → EN_ROUTE → CHECKED_IN → IN_PROGRESS → CHECKED_OUT. The assignment's on-site columns
 * (owned by dispatch, written by Sprint 6's check-in/out in production) are set directly here: this
 * fixture tests the upload side, not the geofence.
 */
export async function checkedOutBooking(
  e2e: E2eApp,
  opts: {
    readonly clientPhone: string;
    readonly proToken: string;
    readonly declaredFrames: number;
    /** Lead time (default 5 days, a 50/50 booking; under 24 h is an emergency paid in full). */
    readonly startInMs?: number;
  },
): Promise<{ bookingId: string; assignmentId: string; checkedOutAt: Date; userId: string }> {
  const userId = await insertUser(e2e.db.sql, opts.clientPhone);
  const start = new Date(e2e.now().getTime() + (opts.startInMs ?? 5 * 86_400_000));
  const { bookingId } = await confirmedBooking(e2e, userId, start, { categoryCode: 'PORTRAIT' });
  await drainOutbox(e2e);
  const offers = await e2e.call('GET', '/pro/offers', { token: opts.proToken });
  const offer = offers.json.data?.find((o: { bookingId: string }) => o.bookingId === bookingId);
  if (!offer)
    throw new Error(`checkedOutBooking: no offer for ${bookingId}: ${JSON.stringify(offers.json)}`);
  const accepted = await e2e.call('POST', `/pro/offers/${offer.attemptId}/accept`, {
    token: opts.proToken,
    idempotencyKey: `media-accept-${bookingId}`,
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.json)}`);
  const assignmentId = accepted.json.data.assignmentId as string;
  await drainOutbox(e2e);
  await walkTo(e2e, bookingId, assignmentId, 'CHECKED_OUT', opts.declaredFrames);
  return { bookingId, assignmentId, checkedOutAt: e2e.now(), userId };
}

/** Walks an ASSIGNED booking forward through BookingsService.transition (never a raw UPDATE). */
export async function walkTo(
  e2e: E2eApp,
  bookingId: string,
  assignmentId: string,
  target: BookingStatus,
  declaredFrames = 0,
): Promise<void> {
  const bookings = e2e.get(BookingsService);
  const sql = e2e.db.sql;
  for (const to of WALK) {
    const now = e2e.now();
    await sql.begin(async (tx) => {
      await bookings.transition(tx, {
        bookingId,
        to,
        actor: { kind: 'PHOTOGRAPHER', id: null },
        occurredAt: now,
        reason: 'media test fixture',
      });
      if (to === 'CHECKED_IN') {
        await tx`UPDATE assignments SET status = 'ACTIVE', check_in_at = ${now} WHERE id = ${assignmentId}`;
      }
      if (to === 'CHECKED_OUT') {
        await tx`
          UPDATE assignments SET status = 'COMPLETED', check_out_at = ${new Date(now.getTime() + 1_000)},
                 declared_frame_count = ${declaredFrames}
          WHERE id = ${assignmentId}`;
        // sla_t0 = the check-out, as CheckOutService records it (Invariant 2; arms the SLA clocks).
        await bookings.recordCheckOut(tx, bookingId, now, new Date(now.getTime() + 48 * 3_600_000));
      }
    });
    if (to === 'EN_ROUTE') {
      await sql`UPDATE assignments SET status = 'EN_ROUTE' WHERE id = ${assignmentId}`;
    }
    if (to === target) break;
  }
  await drainOutbox(e2e);
}
