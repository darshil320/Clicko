import { Injectable } from '@nestjs/common';
import type { Db, Tx } from '../ports';
import type { DeductionSource } from '../rules/assess';

export interface DeductionRecord {
  readonly payoutId: string;
  readonly photographerId: string;
  readonly bookingId: string;
  readonly sourceKind: DeductionSource;
  readonly sourceId: string;
  readonly basisPaise: bigint;
  readonly rateBps: number;
  readonly amountPaise: bigint;
}

interface Row {
  payout_id: string;
  photographer_id: string;
  booking_id: string;
  source_kind: DeductionSource;
  source_id: string;
  basis_paise: string;
  rate_bps: number;
  amount_paise: string;
}

const toRecord = (r: Row): DeductionRecord => ({
  payoutId: r.payout_id,
  photographerId: r.photographer_id,
  bookingId: r.booking_id,
  sourceKind: r.source_kind,
  sourceId: r.source_id,
  basisPaise: BigInt(r.basis_paise),
  rateBps: r.rate_bps,
  amountPaise: BigInt(r.amount_paise),
});

/** payout_deductions (addendum 0009): each breach or penalty deduction, recognised once. */
@Injectable()
export class DeductionsRepository {
  async insert(tx: Tx, rows: readonly DeductionRecord[]): Promise<void> {
    for (const d of rows) {
      await tx`
        INSERT INTO payout_deductions (payout_id, photographer_id, booking_id, source_kind,
                                       source_id, basis_paise, rate_bps, amount_paise)
        VALUES (${d.payoutId}, ${d.photographerId}, ${d.bookingId}, ${d.sourceKind},
                ${d.sourceId}, ${d.basisPaise.toString()}::bigint, ${d.rateBps},
                ${d.amountPaise.toString()}::bigint)`;
    }
  }

  /** The sources (breach or penalty ids) already recognised on some payout. */
  async recognised(db: Db, sourceIds: readonly string[]): Promise<Set<string>> {
    if (sourceIds.length === 0) return new Set();
    const rows = await db<{ source_id: string }[]>`
      SELECT source_id FROM payout_deductions WHERE source_id IN ${db([...new Set(sourceIds)])}`;
    return new Set(rows.map((r) => r.source_id));
  }

  async forPayouts(db: Db, payoutIds: readonly string[]): Promise<DeductionRecord[]> {
    if (payoutIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT payout_id, photographer_id, booking_id, source_kind, source_id, basis_paise,
             rate_bps, amount_paise
      FROM payout_deductions WHERE payout_id IN ${db([...new Set(payoutIds)])}
      ORDER BY created_at, id`;
    return rows.map(toRecord);
  }
}

/** vendor_invoices: one per payout, raised when the batch is exported. */
@Injectable()
export class VendorInvoicesRepository {
  async raise(
    tx: Tx,
    v: {
      readonly photographerId: string;
      readonly bookingId: string;
      readonly taxablePaise: bigint;
      readonly selfBilled: boolean;
      readonly at: Date;
    },
  ): Promise<string> {
    const amount = v.taxablePaise.toString();
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO vendor_invoices (photographer_id, booking_id, taxable_amount_paise,
                                   gst_amount_paise, total_amount_paise, is_self_billed, issued_at)
      VALUES (${v.photographerId}, ${v.bookingId}, ${amount}::bigint, 0, ${amount}::bigint,
              ${v.selfBilled}, ${v.at})
      ON CONFLICT (booking_id, photographer_id) DO UPDATE SET booking_id = EXCLUDED.booking_id
      RETURNING id`;
    if (!row) throw new Error('vendor_invoices.raise: no row');
    return row.id;
  }
}
