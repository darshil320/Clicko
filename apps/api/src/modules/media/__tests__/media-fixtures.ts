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
  },
): Promise<{ bookingId: string; assignmentId: string; checkedOutAt: Date }> {
  const userId = await insertUser(e2e.db.sql, opts.clientPhone);
  const start = new Date(e2e.now().getTime() + 5 * 86_400_000);
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
  return { bookingId, assignmentId, checkedOutAt: e2e.now() };
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
      }
    });
    if (to === 'EN_ROUTE') {
      await sql`UPDATE assignments SET status = 'EN_ROUTE' WHERE id = ${assignmentId}`;
    }
    if (to === target) break;
  }
  await drainOutbox(e2e);
}
