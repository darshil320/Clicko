import type { SlaKind } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
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
}

/** sla_breaches (schema §10). One row per breached clock; applied by the S9 finance desk. */
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
    const rows = await db<
      {
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
      }[]
    >`
      SELECT id, booking_id, clock_id, kind, delay_minutes, band, client_remedy_kind,
             client_remedy_paise, payout_deduction_bps, attributed_to, applied_at
      FROM sla_breaches WHERE booking_id = ${bookingId} ORDER BY created_at`;
    return rows.map((r) => ({
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
    }));
  }
}
