import { Injectable } from '@nestjs/common';
import type { Db, RoundOutcome, RoundRecord, Tx } from '../dispatch.types';

interface RoundRow {
  id: string;
  booking_id: string;
  wave: number;
  radius_km: number;
  candidate_count: number;
  window_seconds: number;
  is_broadcast: boolean;
  started_at: Date;
  ended_at: Date | null;
  outcome: RoundOutcome | null;
}

const toRound = (r: RoundRow): RoundRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  wave: r.wave,
  radiusKm: r.radius_km,
  candidateCount: r.candidate_count,
  windowSeconds: r.window_seconds,
  isBroadcast: r.is_broadcast,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  outcome: r.outcome,
});

const COLUMNS = `id, booking_id, wave, radius_km::float8 AS radius_km, candidate_count, window_seconds,
  is_broadcast, started_at, ended_at, outcome`;

export interface NewRound {
  readonly bookingId: string;
  readonly wave: number;
  readonly radiusKm: number;
  readonly candidateCount: number;
  readonly windowSeconds: number;
  readonly isBroadcast: boolean;
  readonly startedAt: Date;
}

/** dispatch_rounds — one wave of offers. Writes only in the caller's transaction. */
@Injectable()
export class RoundsRepository {
  async forBooking(db: Db, bookingId: string): Promise<RoundRecord[]> {
    const rows = await db<RoundRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM dispatch_rounds WHERE booking_id = ${bookingId} ORDER BY wave`;
    return rows.map(toRound);
  }

  async find(db: Db, roundId: string): Promise<RoundRecord | null> {
    const [row] = await db<RoundRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM dispatch_rounds WHERE id = ${roundId}`;
    return row ? toRound(row) : null;
  }

  async lock(tx: Tx, roundId: string): Promise<RoundRecord | null> {
    const [row] = await tx<RoundRow[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM dispatch_rounds WHERE id = ${roundId} FOR UPDATE`;
    return row ? toRound(row) : null;
  }

  async openForBooking(db: Db, bookingId: string): Promise<RoundRecord | null> {
    const [row] = await db<RoundRow[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM dispatch_rounds
      WHERE booking_id = ${bookingId} AND ended_at IS NULL ORDER BY wave DESC LIMIT 1`;
    return row ? toRound(row) : null;
  }

  async insert(tx: Tx, r: NewRound): Promise<RoundRecord> {
    const [row] = await tx<RoundRow[]>`
      INSERT INTO dispatch_rounds
        (booking_id, wave, radius_km, candidate_count, window_seconds, is_broadcast, started_at)
      VALUES (${r.bookingId}, ${r.wave}, ${r.radiusKm}, ${r.candidateCount}, ${r.windowSeconds},
              ${r.isBroadcast}, ${r.startedAt})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('rounds.insert: no row returned');
    return toRound(row);
  }

  async end(tx: Tx, roundId: string, outcome: RoundOutcome, at: Date): Promise<void> {
    await tx`
      UPDATE dispatch_rounds SET ended_at = ${at}, outcome = ${outcome}
      WHERE id = ${roundId} AND ended_at IS NULL`;
  }

  /** Every still-open round of the booking (a cancellation or a fill closes them all). */
  async endOpen(tx: Tx, bookingId: string, outcome: RoundOutcome, at: Date): Promise<void> {
    await tx`
      UPDATE dispatch_rounds SET ended_at = ${at}, outcome = ${outcome}
      WHERE booking_id = ${bookingId} AND ended_at IS NULL`;
  }

  /** Open rounds whose window closed before `cutoff` — the sweeper's backlog. */
  async overdue(db: Db, cutoff: Date, limit: number): Promise<string[]> {
    const rows = await db<{ id: string }[]>`
      SELECT id FROM dispatch_rounds
      WHERE ended_at IS NULL AND started_at + make_interval(secs => window_seconds) <= ${cutoff}
      ORDER BY started_at LIMIT ${limit}`;
    return rows.map((r) => r.id);
  }
}
