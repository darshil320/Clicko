import { Injectable } from '@nestjs/common';
import type { Db, Tx } from '../ports';

/** payouts.status (schema `payout_status`); the payouts module uses five of them. */
/**
 * PENDING due / in a draft · APPROVED exported, not yet in a bank file · PROCESSING in a bank file,
 * waiting for the UTR · PAID · FAILED (the bank returned it).
 */
export type PayoutStatus = 'PENDING' | 'APPROVED' | 'PROCESSING' | 'PAID' | 'FAILED' | 'WITHHELD';

export interface PayoutRecord {
  readonly id: string;
  readonly batchId: string | null;
  readonly photographerId: string;
  readonly bookingId: string;
  readonly bankAccountId: string | null;
  readonly status: PayoutStatus;
  readonly grossPaise: bigint;
  readonly penaltyDeductionPaise: bigint;
  readonly otherDeductionPaise: bigint;
  readonly tdsSection: string | null;
  readonly tdsRateBps: number;
  readonly tdsPaise: bigint;
  readonly tdsBasePaise: bigint;
  readonly netPaise: bigint;
  readonly eligibleAt: Date;
  readonly reference: string | null;
  readonly utr: string | null;
  readonly paidAt: Date | null;
  readonly failureReason: string | null;
  /** The batch's export time (the credit date); null until then. */
  readonly creditedAt: Date | null;
  readonly batchReference: string | null;
}

interface Row {
  id: string;
  batch_id: string | null;
  photographer_id: string;
  booking_id: string;
  bank_account_id: string | null;
  status: PayoutStatus;
  gross_paise: string;
  penalty_deduction_paise: string;
  other_deduction_paise: string;
  tds_section: string | null;
  tds_rate_bps: number;
  tds_paise: string;
  tds_base_paise: string;
  net_paise: string;
  eligible_at: Date;
  provider_payout_id: string | null;
  utr: string | null;
  paid_at: Date | null;
  failure_reason: string | null;
  credited_at: Date | null;
  batch_ref: string | null;
}

const COLUMNS = `p.id, p.batch_id, p.photographer_id, p.booking_id, p.bank_account_id, p.status,
  p.gross_paise, p.penalty_deduction_paise, p.other_deduction_paise, p.tds_section, p.tds_rate_bps,
  p.tds_paise, p.tds_base_paise, p.net_paise, p.eligible_at, p.provider_payout_id, p.utr,
  p.paid_at, p.failure_reason, b.approved_at AS credited_at, b.batch_ref`;
const FROM = 'payouts p LEFT JOIN payout_batches b ON b.id = p.batch_id';

const toRecord = (r: Row): PayoutRecord => ({
  id: r.id,
  batchId: r.batch_id,
  photographerId: r.photographer_id,
  bookingId: r.booking_id,
  bankAccountId: r.bank_account_id,
  status: r.status,
  grossPaise: BigInt(r.gross_paise),
  penaltyDeductionPaise: BigInt(r.penalty_deduction_paise),
  otherDeductionPaise: BigInt(r.other_deduction_paise),
  tdsSection: r.tds_section,
  tdsRateBps: r.tds_rate_bps,
  tdsPaise: BigInt(r.tds_paise),
  tdsBasePaise: BigInt(r.tds_base_paise),
  netPaise: BigInt(r.net_paise),
  eligibleAt: r.eligible_at,
  reference: r.provider_payout_id,
  utr: r.utr,
  paidAt: r.paid_at,
  failureReason: r.failure_reason,
  creditedAt: r.credited_at,
  batchReference: r.batch_ref,
});

const pg = (paise: bigint): string => paise.toString();

export interface NewPayout {
  readonly bookingId: string;
  readonly photographerId: string;
  readonly grossPaise: bigint;
  readonly eligibleAt: Date;
}

export interface PayoutAssessmentRow {
  readonly payoutId: string;
  readonly bankAccountId: string;
  readonly tdsSection: string | null;
  readonly tdsRateBps: number;
  readonly tdsPaise: bigint;
  readonly tdsBasePaise: bigint;
  readonly penaltyPaise: bigint;
  readonly otherPaise: bigint;
  readonly netPaise: bigint;
}

/**
 * payouts (schema §11 + addendum 0009). One row per booking and photographer, created when the
 * booking is delivered; assessed into a draft batch; credited at export; paid with a UTR.
 */
@Injectable()
export class PayoutsRepository {
  /** Idempotent per (booking, photographer) — the subscriber is at-least-once. */
  async insert(tx: Tx, p: NewPayout): Promise<{ id: string; created: boolean }> {
    const [row] = await tx<{ id: string }[]>`
      INSERT INTO payouts (booking_id, photographer_id, gross_paise, net_paise, eligible_at)
      VALUES (${p.bookingId}, ${p.photographerId}, ${pg(p.grossPaise)}::bigint,
              ${pg(p.grossPaise)}::bigint, ${p.eligibleAt})
      ON CONFLICT (booking_id, photographer_id) DO NOTHING
      RETURNING id`;
    if (row) return { id: row.id, created: true };
    const [existing] = await tx<{ id: string }[]>`
      SELECT id FROM payouts
      WHERE booking_id = ${p.bookingId} AND photographer_id = ${p.photographerId}`;
    if (!existing) throw new Error('payouts.insert: no row');
    return { id: existing.id, created: false };
  }

  /** Not in any batch and due by `at`, oldest first. */
  async dueBy(db: Db, at: Date): Promise<PayoutRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE p.status = 'PENDING' AND p.batch_id IS NULL AND p.eligible_at <= ${at}
      ORDER BY p.eligible_at, p.id`;
    return rows.map(toRecord);
  }

  /** Falling due in (from, until]. */
  async dueBetween(db: Db, from: Date, until: Date): Promise<PayoutRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE p.status = 'PENDING' AND p.batch_id IS NULL
        AND p.eligible_at > ${from} AND p.eligible_at <= ${until}
      ORDER BY p.eligible_at, p.id`;
    return rows.map(toRecord);
  }

  async forBatch(db: Db, batchId: string): Promise<PayoutRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE p.batch_id = ${batchId} ORDER BY p.photographer_id, p.eligible_at, p.id`;
    return rows.map(toRecord);
  }

  /** Row locks on a batch's payouts, for the caller's transaction. */
  async lockBatch(tx: Tx, batchId: string): Promise<void> {
    await tx`SELECT id FROM payouts WHERE batch_id = ${batchId} ORDER BY id FOR UPDATE`;
  }

  /** These photographers' payouts due since `since` (deduction bases, credited or not). */
  async recentFor(
    db: Db,
    photographerIds: readonly string[],
    since: Date,
  ): Promise<PayoutRecord[]> {
    if (photographerIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE p.photographer_id IN ${db([...new Set(photographerIds)])} AND p.eligible_at >= ${since}`;
    return rows.map(toRecord);
  }

  /** Payouts credited (exported) at or after `since`, for the TDS year to date. */
  async creditedSince(
    db: Db,
    photographerIds: readonly string[],
    since: Date,
  ): Promise<PayoutRecord[]> {
    if (photographerIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE p.photographer_id IN ${db([...new Set(photographerIds)])}
        AND b.approved_at IS NOT NULL AND b.approved_at >= ${since}`;
    return rows.map(toRecord);
  }

  /** Every payout credited in [start, end), by credit date (the TDS report). */
  async creditedBetween(db: Db, start: Date, end: Date): Promise<PayoutRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM ${db.unsafe(FROM)}
      WHERE b.approved_at >= ${start} AND b.approved_at < ${end}
      ORDER BY b.approved_at, p.photographer_id, p.eligible_at, p.id`;
    return rows.map(toRecord);
  }

  /** The first credit date on record (null before the first export). */
  async firstCreditedAt(db: Db): Promise<Date | null> {
    const [row] = await db<{ at: Date | null }[]>`
      SELECT min(approved_at) AS at FROM payout_batches WHERE approved_at IS NOT NULL`;
    return row?.at ?? null;
  }

  /**
   * Still owed per photographer from batches credited before `before` (all, when null):
   * deductions recognised minus deductions recovered. The ledger's VENDOR_RECOVERABLE balance.
   */
  async carryIn(
    db: Db,
    photographerIds: readonly string[],
    before: Date | null,
  ): Promise<Map<string, bigint>> {
    if (photographerIds.length === 0) return new Map();
    const ids = db([...new Set(photographerIds)]);
    const cut = before ? db`AND b.approved_at < ${before}` : db``;
    const rows = await db<{ photographer_id: string; owed: string }[]>`
      SELECT photographer_id, sum(amount)::text AS owed FROM (
        SELECT d.photographer_id, d.amount_paise AS amount
        FROM payout_deductions d
        JOIN payouts p ON p.id = d.payout_id JOIN payout_batches b ON b.id = p.batch_id
        WHERE d.photographer_id IN ${ids} AND b.approved_at IS NOT NULL ${cut}
        UNION ALL
        SELECT p.photographer_id, -(p.penalty_deduction_paise + p.other_deduction_paise)
        FROM payouts p JOIN payout_batches b ON b.id = p.batch_id
        WHERE p.photographer_id IN ${ids} AND b.approved_at IS NOT NULL ${cut}
      ) owed
      GROUP BY photographer_id`;
    return new Map(rows.map((r) => [r.photographer_id, BigInt(r.owed)]));
  }

  async assignToBatch(
    tx: Tx,
    batchId: string,
    rows: readonly PayoutAssessmentRow[],
  ): Promise<void> {
    for (const r of rows) {
      const updated = await tx`
        UPDATE payouts SET
          batch_id = ${batchId}, bank_account_id = ${r.bankAccountId},
          tds_section = ${r.tdsSection}, tds_rate_bps = ${r.tdsRateBps},
          tds_paise = ${pg(r.tdsPaise)}::bigint, tds_base_paise = ${pg(r.tdsBasePaise)}::bigint,
          penalty_deduction_paise = ${pg(r.penaltyPaise)}::bigint,
          other_deduction_paise = ${pg(r.otherPaise)}::bigint, net_paise = ${pg(r.netPaise)}::bigint
        WHERE id = ${r.payoutId} AND status = 'PENDING' AND batch_id IS NULL`;
      if (updated.count !== 1) throw new Error(`payout ${r.payoutId} is no longer due`);
    }
  }

  /** A discarded draft: its payouts are due again, with nothing assessed. */
  async release(tx: Tx, batchId: string): Promise<number> {
    await tx`
      DELETE FROM payout_deductions
      WHERE payout_id IN (SELECT id FROM payouts WHERE batch_id = ${batchId} AND status = 'PENDING')`;
    const res = await tx`
      UPDATE payouts SET batch_id = NULL, bank_account_id = NULL, tds_section = NULL,
        tds_rate_bps = 0, tds_paise = 0, tds_base_paise = 0, penalty_deduction_paise = 0,
        other_deduction_paise = 0, net_paise = gross_paise
      WHERE batch_id = ${batchId} AND status = 'PENDING'`;
    return res.count;
  }

  async setVendorInvoice(tx: Tx, payoutId: string, invoiceId: string): Promise<void> {
    await tx`UPDATE payouts SET vendor_invoice_id = ${invoiceId} WHERE id = ${payoutId}`;
  }

  /** Export: a transfer is ready for the next bank file under its reference … */
  async markReady(tx: Tx, ids: readonly string[], reference: string, provider: string) {
    if (ids.length === 0) return;
    await tx`
      UPDATE payouts SET status = 'APPROVED', provider = ${provider},
        provider_payout_id = ${reference}
      WHERE id IN ${tx([...ids])} AND status = 'PENDING'`;
  }

  /** … or, with nothing left to pay, is settled at once. */
  async markSettled(tx: Tx, ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx`
      UPDATE payouts SET status = 'PAID', paid_at = ${at}
      WHERE id IN ${tx([...ids])} AND status = 'PENDING'`;
  }

  /** Written into a bank file: never written into another one (no double payment). */
  async markSent(tx: Tx, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await tx`
      UPDATE payouts SET status = 'PROCESSING'
      WHERE id IN ${tx([...ids])} AND status = 'APPROVED'`;
    return res.count;
  }

  async markPaid(tx: Tx, ids: readonly string[], utr: string, at: Date): Promise<number> {
    const res = await tx`
      UPDATE payouts SET status = 'PAID', utr = ${utr}, paid_at = ${at}
      WHERE id IN ${tx([...ids])} AND status = 'PROCESSING'`;
    return res.count;
  }

  /** A UTR already recorded for another photographer's transfer. */
  async utrUsedByOther(db: Db, utr: string, photographerId: string): Promise<boolean> {
    const [row] = await db`
      SELECT 1 FROM payouts WHERE utr = ${utr} AND photographer_id <> ${photographerId} LIMIT 1`;
    return row !== undefined;
  }

  async markFailed(tx: Tx, ids: readonly string[], reason: string, at: Date): Promise<void> {
    await tx`
      UPDATE payouts SET status = 'FAILED', failed_at = ${at}, failure_reason = ${reason}
      WHERE id IN ${tx([...ids])} AND status = 'PROCESSING'`;
  }

  /** Back into the next bank file under a NEW reference, so a bank sees it as a new payment. */
  async retry(
    tx: Tx,
    ids: readonly string[],
    bankAccountId: string,
    reference: string,
  ): Promise<void> {
    await tx`
      UPDATE payouts SET status = 'APPROVED', failed_at = NULL, failure_reason = NULL,
        bank_account_id = ${bankAccountId}, provider_payout_id = ${reference}
      WHERE id IN ${tx([...ids])} AND status = 'FAILED'`;
  }

  /** Today page: due before `until` and not in a batch. */
  async dueCount(db: Db, until: Date): Promise<{ count: number; grossPaise: bigint }> {
    const [row] = await db<{ n: number; gross: string }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(gross_paise), 0)::text AS gross FROM payouts
      WHERE status = 'PENDING' AND batch_id IS NULL AND eligible_at < ${until}`;
    return { count: row?.n ?? 0, grossPaise: BigInt(row?.gross ?? '0') };
  }
}
