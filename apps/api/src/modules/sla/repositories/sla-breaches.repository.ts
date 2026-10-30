import type { SlaKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { BreachBand, RemedyKind } from '../sla.config';
import type { Db, Tx } from '../sla.types';

export type BreachAttribution = 'PHOTOGRAPHER' | 'CLICKCO' | 'CLIENT' | 'FORCE_MAJEURE';

export interface NewBreach {
  readonly bookingId: string;
  readonly clockId: string;
  readonly kind: SlaKind;
  readonly delayMinutes: number;
  readonly band: BreachBand;
  readonly remedyKind: RemedyKind;
  readonly remedyPaise: bigint;
  readonly payoutDeductionBps: number;
  readonly attributedTo: BreachAttribution;
}

export interface BreachRecord extends NewBreach {
  readonly id: string;
  readonly appliedAt: Date | null;
  readonly waivedBy: string | null;
  readonly waiveReason: string | null;
  readonly createdAt: Date;
}

/** OPEN = neither applied nor waived. */
export type BreachStatusFilter = 'OPEN' | 'WAIVED' | 'ALL';

export interface BreachPageQuery {
  readonly status: BreachStatusFilter;
  /** Only breaches of these bookings (the caller's city scope); null = every booking. */
  readonly bookings: IdSubquery | null;
  /** Keyset: strictly after this row in (created_at DESC, id DESC) order. */
  readonly after?: { readonly createdAt: Date; readonly id: string };
  readonly limit: number;
}

interface Row {
  id: string;
  booking_id: string;
  clock_id: string;
  kind: SlaKind;
  delay_minutes: number;
  band: BreachBand;
  client_remedy_kind: RemedyKind;
  client_remedy_paise: string;
  payout_deduction_bps: number;
  attributed_to: BreachAttribution;
  applied_at: Date | null;
  waived_by: string | null;
  waive_reason: string | null;
  created_at: Date;
}

const COLUMNS = `id, booking_id, clock_id, kind, delay_minutes, band, client_remedy_kind,
  client_remedy_paise, payout_deduction_bps, attributed_to, applied_at, waived_by, waive_reason,
  created_at`;

const toRecord = (r: Row): BreachRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  clockId: r.clock_id,
  kind: r.kind,
  delayMinutes: r.delay_minutes,
  band: r.band,
  remedyKind: r.client_remedy_kind,
  remedyPaise: BigInt(r.client_remedy_paise),
  payoutDeductionBps: r.payout_deduction_bps,
  attributedTo: r.attributed_to,
  appliedAt: r.applied_at,
  waivedBy: r.waived_by,
  waiveReason: r.waive_reason,
  createdAt: r.created_at,
});

/** sla_breaches (schema §10). One row per breached clock; applied by the S9 finance desk. */
/**
 * Only a breach put down to the photographer or Clickco can owe a remedy or a payout deduction
 * (ADR-0016 D9). CLIENT / FORCE_MAJEURE keep their priced amounts for the record but owe nothing.
 */
export const OWED_ATTRIBUTIONS: readonly BreachAttribution[] = ['PHOTOGRAPHER', 'CLICKCO'];

/** Still owed: not applied, not waived, and attributed to the photographer or Clickco. */
export const isOwed = (b: Pick<BreachRecord, 'appliedAt' | 'waivedBy' | 'attributedTo'>): boolean =>
  b.appliedAt === null && b.waivedBy === null && OWED_ATTRIBUTIONS.includes(b.attributedTo);

@Injectable()
export class SlaBreachesRepository {
  /** Idempotent per clock (at-least-once subscribers). Returns the id, new or existing. */
  async record(tx: Tx, b: NewBreach): Promise<{ id: string; created: boolean }> {
    const [existing] = await tx<{ id: string }[]>`
      SELECT id FROM sla_breaches WHERE clock_id = ${b.clockId}`;
    if (existing) return { id: existing.id, created: false };
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO sla_breaches (booking_id, clock_id, kind, delay_minutes, band, client_remedy_kind,
                                client_remedy_paise, payout_deduction_bps, attributed_to)
      VALUES (${b.bookingId}, ${b.clockId}, ${b.kind}, ${b.delayMinutes}, ${b.band}, ${b.remedyKind},
              ${b.remedyPaise.toString()}::bigint, ${b.payoutDeductionBps}, ${b.attributedTo})
      RETURNING id`;
    if (!row) throw new Error('sla_breaches.record: no row returned');
    return { id: row.id, created: true };
  }

  async forBooking(db: Db, bookingId: string): Promise<BreachRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_breaches WHERE booking_id = ${bookingId}
      ORDER BY created_at`;
    return rows.map(toRecord);
  }

  async forBookings(db: Db, bookingIds: readonly string[]): Promise<BreachRecord[]> {
    if (bookingIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_breaches
      WHERE booking_id IN ${db([...new Set(bookingIds)])} ORDER BY created_at`;
    return rows.map(toRecord);
  }

  async find(db: Db, id: string): Promise<BreachRecord | null> {
    const [row] = await db<Row[]>`SELECT ${db.unsafe(COLUMNS)} FROM sla_breaches WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string): Promise<BreachRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM sla_breaches WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  /** The staff breach board, newest first (ADR-0025 D5). */
  async page(db: Db, q: BreachPageQuery): Promise<BreachRecord[]> {
    const status =
      q.status === 'OPEN'
        ? db`applied_at IS NULL AND waived_by IS NULL AND attributed_to IN ${db(OWED_ATTRIBUTIONS)}`
        : q.status === 'WAIVED'
          ? db`waived_by IS NOT NULL`
          : db`TRUE`;
    const bookings = q.bookings ? db`booking_id IN (${q.bookings})` : db`TRUE`;
    const after = q.after
      ? db`(created_at, id) < (${q.after.createdAt}, ${q.after.id}::uuid)`
      : db`TRUE`;
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM sla_breaches
      WHERE ${status} AND ${bookings} AND ${after}
      ORDER BY created_at DESC, id DESC
      LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  /**
   * Re-attribution (ADR-0016 D9, T&C §5.3). The priced remedy columns stay as the record of what
   * the breach would have cost; whether anything is owed is `isOwed` (attribution + waiver).
   */
  async setAttribution(tx: Tx, id: string, to: BreachAttribution): Promise<void> {
    await tx`UPDATE sla_breaches SET attributed_to = ${to} WHERE id = ${id}`;
  }

  /**
   * ADR-0026 D2: the remedy was applied (credit issued or refund requested) and the payout
   * deduction is now recorded. Only an owed breach is touched; returns whether it was.
   */
  async markApplied(tx: Tx, id: string, at: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE sla_breaches SET applied_at = ${at}
      WHERE id = ${id} AND applied_at IS NULL AND waived_by IS NULL
        AND attributed_to IN ${tx(OWED_ATTRIBUTIONS)}
      RETURNING id`;
    return rows.length === 1;
  }

  /** No remedy will be applied (ADR-0025 D5). Only an unapplied, unwaived breach is touched. */
  async waive(tx: Tx, id: string, staffId: string, reason: string): Promise<void> {
    await tx`
      UPDATE sla_breaches SET waived_by = ${staffId}, waive_reason = ${reason}
      WHERE id = ${id} AND applied_at IS NULL AND waived_by IS NULL`;
  }
}
