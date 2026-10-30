import { Injectable } from '@nestjs/common';
import type { Db, Tx } from '../ports';

/**
 * payout_batches.status reuses the schema's `payout_status`: PENDING = draft, PROCESSING = bank
 * file exported (approved_by/approved_at = who exported it, when: the credit date), PAID = every
 * transfer settled (processed_at).
 */
export type BatchStatus = 'PENDING' | 'PROCESSING' | 'PAID';

export interface BatchRecord {
  readonly id: string;
  readonly reference: string;
  readonly status: BatchStatus;
  readonly grossPaise: bigint;
  readonly tdsPaise: bigint;
  readonly netPaise: bigint;
  readonly itemCount: number;
  readonly exportedBy: string | null;
  readonly exportedAt: Date | null;
  readonly paidAt: Date | null;
  readonly createdAt: Date;
}

/** Per batch: transfers (photographer groups) by state. */
export interface BatchCounts {
  readonly payees: number;
  /** Exported, not yet in a bank file. */
  readonly ready: number;
  /** In a bank file, waiting for the UTR. */
  readonly awaiting: number;
  readonly paid: number;
  readonly failed: number;
}

interface Row {
  id: string;
  batch_ref: string;
  status: BatchStatus;
  total_gross_paise: string;
  total_tds_paise: string;
  total_net_paise: string;
  item_count: number;
  approved_by: string | null;
  approved_at: Date | null;
  processed_at: Date | null;
  created_at: Date;
}

const COLUMNS = `id, batch_ref, status, total_gross_paise, total_tds_paise, total_net_paise,
  item_count, approved_by, approved_at, processed_at, created_at`;

const toRecord = (r: Row): BatchRecord => ({
  id: r.id,
  reference: r.batch_ref,
  status: r.status,
  grossPaise: BigInt(r.total_gross_paise),
  tdsPaise: BigInt(r.total_tds_paise),
  netPaise: BigInt(r.total_net_paise),
  itemCount: r.item_count,
  exportedBy: r.approved_by,
  exportedAt: r.approved_at,
  paidAt: r.processed_at,
  createdAt: r.created_at,
});

export interface BatchTotals {
  readonly grossPaise: bigint;
  readonly tdsPaise: bigint;
  readonly netPaise: bigint;
  readonly itemCount: number;
}

@Injectable()
export class BatchesRepository {
  /** Serialises draft creation (plus the one-draft unique index, addendum 0009). */
  async lockDrafting(tx: Tx): Promise<void> {
    await tx`SELECT pg_advisory_xact_lock(hashtext('payouts:batches'))`;
  }

  async create(tx: Tx, reference: string, totals: BatchTotals, at: Date): Promise<BatchRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO payout_batches (batch_ref, status, total_gross_paise, total_tds_paise,
                                  total_net_paise, item_count, created_at)
      VALUES (${reference}, 'PENDING', ${totals.grossPaise.toString()}::bigint,
              ${totals.tdsPaise.toString()}::bigint, ${totals.netPaise.toString()}::bigint,
              ${totals.itemCount}, ${at})
      RETURNING ${tx.unsafe(COLUMNS)}`;
    if (!row) throw new Error('payout_batches.create: no row');
    return toRecord(row);
  }

  async find(db: Db, id: string): Promise<BatchRecord | null> {
    const [row] = await db<
      Row[]
    >`SELECT ${db.unsafe(COLUMNS)} FROM payout_batches WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string): Promise<BatchRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM payout_batches WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async draft(db: Db): Promise<BatchRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM payout_batches WHERE status = 'PENDING' LIMIT 1`;
    return row ? toRecord(row) : null;
  }

  async referenceExists(db: Db, reference: string): Promise<boolean> {
    const [row] = await db`SELECT 1 FROM payout_batches WHERE batch_ref = ${reference}`;
    return row !== undefined;
  }

  /** How many references start with `prefix` (a day's off-cycle batches). */
  async countWithPrefix(db: Db, prefix: string): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payout_batches WHERE starts_with(batch_ref, ${prefix})`;
    return row?.n ?? 0;
  }

  /** Newest first; keyset strictly after (created_at, id). */
  async page(
    db: Db,
    after: { readonly createdAt: Date; readonly id: string } | undefined,
    limit: number,
  ): Promise<BatchRecord[]> {
    const cut = after ? db`WHERE (created_at, id) < (${after.createdAt}, ${after.id}::uuid)` : db``;
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM payout_batches ${cut}
      ORDER BY created_at DESC, id DESC LIMIT ${limit}`;
    return rows.map(toRecord);
  }

  async counts(db: Db, batchIds: readonly string[]): Promise<Map<string, BatchCounts>> {
    if (batchIds.length === 0) return new Map();
    const rows = await db<
      {
        batch_id: string;
        payees: number;
        ready: number;
        awaiting: number;
        paid: number;
        failed: number;
      }[]
    >`
      SELECT batch_id,
             count(*)::int AS payees,
             count(*) FILTER (WHERE state = 'APPROVED')::int AS ready,
             count(*) FILTER (WHERE state = 'PROCESSING')::int AS awaiting,
             count(*) FILTER (WHERE state = 'PAID' AND has_utr)::int AS paid,
             count(*) FILTER (WHERE state = 'FAILED')::int AS failed
      FROM (
        SELECT batch_id, photographer_id, min(status::text) AS state, bool_or(utr IS NOT NULL) AS has_utr
        FROM payouts WHERE batch_id IN ${db([...new Set(batchIds)])}
        GROUP BY batch_id, photographer_id
      ) transfers
      GROUP BY batch_id`;
    return new Map(
      rows.map((r) => [
        r.batch_id,
        {
          payees: r.payees,
          ready: r.ready,
          awaiting: r.awaiting,
          paid: r.paid,
          failed: r.failed,
        },
      ]),
    );
  }

  async markExported(
    tx: Tx,
    id: string,
    staffId: string,
    at: Date,
    settled: boolean,
  ): Promise<void> {
    await tx`
      UPDATE payout_batches SET status = ${settled ? 'PAID' : 'PROCESSING'},
        approved_by = ${staffId}, approved_at = ${at}, processed_at = ${settled ? at : null}
      WHERE id = ${id} AND status = 'PENDING'`;
  }

  async markPaid(tx: Tx, id: string, at: Date): Promise<void> {
    await tx`
      UPDATE payout_batches SET status = 'PAID', processed_at = ${at}
      WHERE id = ${id} AND status = 'PROCESSING'`;
  }

  async deleteDraft(tx: Tx, id: string): Promise<void> {
    await tx`DELETE FROM payout_batches WHERE id = ${id} AND status = 'PENDING'`;
  }

  /** Exported batches with a transfer still awaiting payment (the Today page). */
  async awaitingPaymentCount(db: Db): Promise<number> {
    const [row] = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM payout_batches WHERE status = 'PROCESSING'`;
    return row?.n ?? 0;
  }
}
