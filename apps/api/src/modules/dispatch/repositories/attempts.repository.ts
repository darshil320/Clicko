import type { DispatchOutcome } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { AttemptRecord, Db, OfferCandidate, PendingOffer, Tx } from '../dispatch.types';

interface AttemptRow {
  id: string;
  round_id: string;
  booking_id: string;
  photographer_id: string;
  rank_score: number | null;
  distance_km: number | null;
  offered_payout_paise: string;
  notified_at: Date;
  expires_at: Date;
  responded_at: Date | null;
  outcome: DispatchOutcome;
  decline_reason: string | null;
}

const toAttempt = (r: AttemptRow): AttemptRecord => ({
  id: r.id,
  roundId: r.round_id,
  bookingId: r.booking_id,
  photographerId: r.photographer_id,
  rankScore: r.rank_score,
  distanceKm: r.distance_km,
  offeredPayoutPaise: BigInt(r.offered_payout_paise),
  notifiedAt: r.notified_at,
  expiresAt: r.expires_at,
  respondedAt: r.responded_at,
  outcome: r.outcome,
  declineReason: r.decline_reason,
});

const COLUMNS = `a.id, a.round_id, a.booking_id, a.photographer_id, a.rank_score::float8 AS rank_score,
  a.distance_km::float8 AS distance_km, a.offered_payout_paise, a.notified_at, a.expires_at,
  a.responded_at, a.outcome, a.decline_reason`;

export interface NewAttempts {
  readonly roundId: string;
  readonly bookingId: string;
  readonly candidates: readonly OfferCandidate[];
  readonly payoutPaise: bigint;
  readonly notifiedAt: Date;
  readonly expiresAt: Date;
}

/** dispatch_attempts — one offer to one photographer. Writes only in the caller's transaction. */
@Injectable()
export class AttemptsRepository {
  async insertMany(tx: Tx, a: NewAttempts): Promise<void> {
    if (a.candidates.length === 0) return;
    await tx`
      INSERT INTO dispatch_attempts (round_id, booking_id, photographer_id, rank_score, distance_km,
                                     offered_payout_paise, notified_at, expires_at)
      SELECT ${a.roundId}, ${a.bookingId}, c.photographer_id, c.rank_score, round(c.distance_km::numeric, 2),
             ${a.payoutPaise.toString()}::bigint, ${a.notifiedAt}, ${a.expiresAt}
      FROM unnest(${a.candidates.map((c) => c.photographerId)}::uuid[],
                  ${a.candidates.map((c) => c.rankScore)}::numeric[],
                  ${a.candidates.map((c) => c.distanceKm)}::float8[])
           AS c(photographer_id, rank_score, distance_km)`;
  }

  /** null for a missing attempt AND for someone else's: offers never leak across photographers. */
  async findForPhotographer(
    db: Db,
    attemptId: string,
    photographerId: string,
  ): Promise<AttemptRecord | null> {
    const [row] = await db<AttemptRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM dispatch_attempts a
      WHERE a.id = ${attemptId} AND a.photographer_id = ${photographerId}`;
    return row ? toAttempt(row) : null;
  }

  async lock(tx: Tx, attemptId: string): Promise<AttemptRecord | null> {
    const [row] = await tx<AttemptRow[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM dispatch_attempts a WHERE a.id = ${attemptId} FOR UPDATE`;
    return row ? toAttempt(row) : null;
  }

  async resolve(
    tx: Tx,
    attemptId: string,
    outcome: DispatchOutcome,
    at: Date,
    reason: string | null = null,
  ): Promise<void> {
    await tx`
      UPDATE dispatch_attempts SET outcome = ${outcome}, responded_at = ${at},
             decline_reason = coalesce(${reason}::text, decline_reason)
      WHERE id = ${attemptId}`;
  }

  /** First accept wins: every other PENDING offer for the booking lost the race. */
  async markLostRace(tx: Tx, bookingId: string, winnerId: string, at: Date): Promise<void> {
    await tx`
      UPDATE dispatch_attempts SET outcome = 'LOST_RACE', responded_at = ${at}
      WHERE booking_id = ${bookingId} AND outcome = 'PENDING' AND id <> ${winnerId}`;
  }

  /** Window closed with no answer (responded_at stays NULL: they never responded). */
  async expirePending(tx: Tx, roundId: string): Promise<void> {
    await tx`UPDATE dispatch_attempts SET outcome = 'EXPIRED' WHERE round_id = ${roundId} AND outcome = 'PENDING'`;
  }

  async cancelPending(tx: Tx, bookingId: string): Promise<void> {
    await tx`
      UPDATE dispatch_attempts SET outcome = 'CANCELLED'
      WHERE booking_id = ${bookingId} AND outcome = 'PENDING'`;
  }

  async pendingCount(tx: Tx, roundId: string): Promise<number> {
    const [row] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM dispatch_attempts WHERE round_id = ${roundId} AND outcome = 'PENDING'`;
    return row?.n ?? 0;
  }

  /** What GET /pro/offers lists: still pending, window still open, newest first. */
  async pendingFor(db: Db, photographerId: string, now: Date): Promise<PendingOffer[]> {
    const rows = await db<(AttemptRow & { is_broadcast: boolean })[]>`
      SELECT ${db.unsafe(COLUMNS)}, r.is_broadcast
      FROM dispatch_attempts a JOIN dispatch_rounds r ON r.id = a.round_id
      WHERE a.photographer_id = ${photographerId} AND a.outcome = 'PENDING'
        AND a.expires_at > ${now} AND r.ended_at IS NULL
      ORDER BY a.notified_at DESC, a.id`;
    return rows.map((r) => ({ ...toAttempt(r), isBroadcast: r.is_broadcast }));
  }

  /** What each accepted booking pays this photographer (the offer they accepted, incentive included). */
  async acceptedPayouts(
    db: Db,
    photographerId: string,
    bookingIds: readonly string[],
  ): Promise<Map<string, bigint>> {
    if (bookingIds.length === 0) return new Map();
    const rows = await db<{ booking_id: string; offered_payout_paise: string }[]>`
      SELECT DISTINCT ON (booking_id) booking_id, offered_payout_paise
      FROM dispatch_attempts
      WHERE photographer_id = ${photographerId} AND outcome = 'ACCEPTED'
        AND booking_id IN ${db([...new Set(bookingIds)])}
      ORDER BY booking_id, responded_at DESC`;
    return new Map(rows.map((r) => [r.booking_id, BigInt(r.offered_payout_paise)]));
  }

  async forBooking(db: Db, bookingId: string): Promise<AttemptRecord[]> {
    const rows = await db<AttemptRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM dispatch_attempts a
      WHERE a.booking_id = ${bookingId} ORDER BY a.rank_score DESC NULLS LAST, a.id`;
    return rows.map(toAttempt);
  }
}
