import type { SlaKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { PlannedClock } from '../rules/schedule';
import type { Db, SlaClockRecord, SlaClockState, Tx } from '../sla.types';

interface Row {
  id: string;
  booking_id: string;
  kind: SlaKind;
  state: SlaClockState;
  anchor_at: Date;
  due_at: Date;
  paused_at: Date | null;
  paused_ms: string;
  met_at: Date | null;
  breached_at: Date | null;
}

const COLUMNS = `id, booking_id, kind, state, anchor_at, due_at, paused_at, paused_ms, met_at,
  breached_at`;

const toRecord = (r: Row): SlaClockRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  kind: r.kind,
  state: r.state,
  anchorAt: r.anchor_at,
  dueAt: r.due_at,
  pausedAt: r.paused_at,
  pausedMs: Number(r.paused_ms),
  metAt: r.met_at,
  breachedAt: r.breached_at,
});

/** sla_clocks (schema §10): one row per (booking, kind). Writes only in the caller's transaction. */
@Injectable()
export class SlaClocksRepository {
  /** Arms the planned clocks; a kind already present is left alone. Returns the new rows. */
  async arm(
    tx: Tx,
    bookingId: string,
    anchorAt: Date,
    planned: readonly PlannedClock[],
  ): Promise<SlaClockRecord[]> {
    if (planned.length === 0) return [];
    const rows = await tx<Row[]>`
      INSERT INTO sla_clocks (booking_id, kind, anchor_at, due_at)
      SELECT ${bookingId}, p.kind::sla_kind, ${anchorAt}, p.due_at
      FROM unnest(${planned.map((p) => p.kind)}::text[], ${planned.map((p) => p.dueAt.toISOString())}::timestamptz[])
           AS p(kind, due_at)
      ON CONFLICT (booking_id, kind) DO NOTHING
      RETURNING ${tx.unsafe(COLUMNS)}`;
    return rows.map(toRecord);
  }

  /** Every clock of these bookings (the staff panel's flags and due times). */
  async forBookings(db: Db, bookingIds: readonly string[]): Promise<SlaClockRecord[]> {
    if (bookingIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_clocks WHERE booking_id IN ${db([...new Set(bookingIds)])}`;
    return rows.map(toRecord);
  }

  async find(db: Db, clockId: string): Promise<SlaClockRecord | null> {
    const [row] = await db<
      Row[]
    >`SELECT ${db.unsafe(COLUMNS)} FROM sla_clocks WHERE id = ${clockId}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, clockId: string): Promise<SlaClockRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM sla_clocks WHERE id = ${clockId} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async forBooking(db: Db, bookingId: string): Promise<SlaClockRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_clocks WHERE booking_id = ${bookingId}
      ORDER BY due_at, kind`;
    return rows.map(toRecord);
  }

  /** ARMED → MET for these kinds (a paused clock resumes: its pause is added to paused_ms). */
  async meet(tx: Tx, bookingId: string, kinds: readonly SlaKind[], at: Date): Promise<void> {
    if (kinds.length === 0) return;
    await tx`
      UPDATE sla_clocks
         SET state = 'MET', met_at = ${at},
             paused_ms = paused_ms + CASE WHEN paused_at IS NULL THEN 0
                           ELSE greatest(0, (extract(epoch FROM (${at}::timestamptz - paused_at)) * 1000)::bigint) END,
             paused_at = NULL
       WHERE booking_id = ${bookingId} AND state = 'ARMED' AND kind = ANY(${tx.array([...kinds])}::sla_kind[])`;
  }

  /** The client-payment pause (ADR-0016 D7): armed clocks of these kinds stop counting. */
  async pause(tx: Tx, bookingId: string, kinds: readonly SlaKind[], at: Date): Promise<void> {
    await tx`
      UPDATE sla_clocks SET paused_at = ${at}
       WHERE booking_id = ${bookingId} AND state = 'ARMED' AND paused_at IS NULL
         AND kind = ANY(${tx.array([...kinds])}::sla_kind[])`;
  }

  async markBreached(tx: Tx, clockId: string, at: Date): Promise<void> {
    await tx`UPDATE sla_clocks SET state = 'BREACHED', breached_at = ${at} WHERE id = ${clockId}`;
  }

  async markMet(tx: Tx, clockId: string, at: Date): Promise<void> {
    await tx`UPDATE sla_clocks SET state = 'MET', met_at = ${at} WHERE id = ${clockId} AND state = 'ARMED'`;
  }

  /** A new due time for an armed clock (reminders, escalation holds). */
  async rearm(tx: Tx, clockId: string, dueAt: Date): Promise<void> {
    await tx`UPDATE sla_clocks SET due_at = ${dueAt} WHERE id = ${clockId} AND state = 'ARMED'`;
  }

  /** Terminal booking: every armed clock is cancelled. */
  async cancelArmed(tx: Tx, bookingId: string): Promise<void> {
    await tx`UPDATE sla_clocks SET state = 'CANCELLED' WHERE booking_id = ${bookingId} AND state = 'ARMED'`;
  }

  /** The sweep: armed, unpaused, overdue (a lost job), oldest first. */
  async overdue(db: Db, now: Date, limit: number): Promise<SlaClockRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_clocks
       WHERE state = 'ARMED' AND paused_at IS NULL AND due_at <= ${now}
       ORDER BY due_at LIMIT ${limit}`;
    return rows.map(toRecord);
  }
}
