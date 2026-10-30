import type { RefundStatus } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type { IdSubquery } from '../../../infra/db/id-subquery';
import type { RefundReasonCode } from '../refunds.config';
import type { Db, RefundRecord, Tx } from '../refunds.types';

const pg = (paise: bigint): string => paise.toString();

interface Row {
  id: string;
  payment_id: string;
  booking_id: string;
  status: RefundStatus;
  amount_paise: string;
  reason_code: RefundReasonCode;
  reason_note: string | null;
  requested_by_kind: RefundRecord['requestedByKind'];
  requested_by_id: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  rejected_by: string | null;
  rejected_at: Date | null;
  decision_note: string | null;
  provider_refund_id: string | null;
  processing_at: Date | null;
  attempts: number;
  completed_at: Date | null;
  failed_at: Date | null;
  failure_reason: string | null;
  review_resolution_id: string | null;
  created_at: Date;
}

const toRecord = (r: Row): RefundRecord => ({
  id: r.id,
  paymentId: r.payment_id,
  bookingId: r.booking_id,
  status: r.status,
  amountPaise: BigInt(r.amount_paise),
  reasonCode: r.reason_code,
  reasonNote: r.reason_note,
  requestedByKind: r.requested_by_kind,
  requestedById: r.requested_by_id,
  approvedBy: r.approved_by,
  approvedAt: r.approved_at,
  rejectedBy: r.rejected_by,
  rejectedAt: r.rejected_at,
  decisionNote: r.decision_note,
  providerRefundId: r.provider_refund_id,
  processingAt: r.processing_at,
  attempts: r.attempts,
  completedAt: r.completed_at,
  failedAt: r.failed_at,
  failureReason: r.failure_reason,
  reviewResolutionId: r.review_resolution_id,
  createdAt: r.created_at,
});

/** Statuses that hold money back from being refunded again (requested, approved or at the gateway). */
export const IN_FLIGHT: readonly RefundStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSING'];
/** Statuses that count against an approver's ceiling (decided to go back, or gone). */
export const COMMITTED: readonly RefundStatus[] = ['APPROVED', 'PROCESSING', 'COMPLETED'];

export interface NewRefund {
  readonly paymentId: string;
  readonly bookingId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: RefundReasonCode;
  readonly reasonNote: string;
  readonly requestedById: string;
  readonly reviewResolutionId: string | null;
  readonly createdAt: Date;
}

export interface RefundPageQuery {
  readonly statuses: readonly RefundStatus[] | null;
  readonly bookings: IdSubquery | null;
  /** Approval queue: oldest first. Everything else: newest first. */
  readonly oldestFirst: boolean;
  readonly after?: { readonly createdAt: Date; readonly id: string };
  readonly limit: number;
}

/** refunds (schema §11 + addendum 0005). Status changes only in the caller's transaction. */
@Injectable()
export class RefundsRepository {
  async insert(tx: Tx, r: NewRefund): Promise<RefundRecord> {
    const [row] = await tx<Row[]>`
      INSERT INTO refunds (payment_id, booking_id, amount_paise, reason_code, reason_note,
                           requested_by_kind, requested_by_id, review_resolution_id, created_at)
      VALUES (${r.paymentId}, ${r.bookingId}, ${pg(r.amountPaise)}, ${r.reasonCode}, ${r.reasonNote},
              'STAFF', ${r.requestedById}, ${r.reviewResolutionId}, ${r.createdAt})
      RETURNING *`;
    if (!row) throw new Error('refunds.insert: no row returned');
    return toRecord(row);
  }

  async find(db: Db, id: string): Promise<RefundRecord | null> {
    const [row] = await db<Row[]>`SELECT * FROM refunds WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string): Promise<RefundRecord | null> {
    const [row] = await tx<Row[]>`SELECT * FROM refunds WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async forBooking(db: Db, bookingId: string): Promise<RefundRecord[]> {
    const rows = await db<Row[]>`
      SELECT * FROM refunds WHERE booking_id = ${bookingId} ORDER BY created_at, id`;
    return rows.map(toRecord);
  }

  async forResolutions(db: Db, resolutionIds: readonly string[]): Promise<RefundRecord[]> {
    if (resolutionIds.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT * FROM refunds WHERE review_resolution_id IN ${db([...new Set(resolutionIds)])}
      ORDER BY created_at, id`;
    return rows.map(toRecord);
  }

  async page(db: Db, q: RefundPageQuery): Promise<RefundRecord[]> {
    const statuses = q.statuses ? db`status IN ${db(q.statuses)}` : db`TRUE`;
    const bookings = q.bookings ? db`booking_id IN (${q.bookings})` : db`TRUE`;
    const after = q.after
      ? q.oldestFirst
        ? db`(created_at, id) > (${q.after.createdAt}, ${q.after.id}::uuid)`
        : db`(created_at, id) < (${q.after.createdAt}, ${q.after.id}::uuid)`
      : db`TRUE`;
    const order = q.oldestFirst ? db`created_at ASC, id ASC` : db`created_at DESC, id DESC`;
    const rows = await db<Row[]>`
      SELECT * FROM refunds WHERE ${statuses} AND ${bookings} AND ${after}
      ORDER BY ${order} LIMIT ${q.limit}`;
    return rows.map(toRecord);
  }

  async count(db: Db, statuses: readonly RefundStatus[], bookings: IdSubquery | null) {
    const scope = bookings ? db`booking_id IN (${bookings})` : db`TRUE`;
    const [row] = await db<{ n: string }[]>`
      SELECT count(*) AS n FROM refunds WHERE status IN ${db(statuses)} AND ${scope}`;
    return Number(row?.n ?? 0);
  }

  /** Per payment: money held by refunds still in flight. */
  async inFlightByPayment(db: Db, paymentIds: readonly string[]): Promise<Map<string, bigint>> {
    if (paymentIds.length === 0) return new Map();
    const rows = await db<{ payment_id: string; total: string }[]>`
      SELECT payment_id, sum(amount_paise) AS total FROM refunds
      WHERE payment_id IN ${db([...new Set(paymentIds)])} AND status IN ${db(IN_FLIGHT)}
      GROUP BY payment_id`;
    return new Map(rows.map((r) => [r.payment_id, BigInt(r.total)]));
  }

  /** Refunds approved, at the gateway or done on a booking (the approver ceiling counts them). */
  async committedForBooking(db: Db, bookingId: string): Promise<bigint> {
    const [row] = await db<{ total: string }[]>`
      SELECT coalesce(sum(amount_paise), 0) AS total FROM refunds
      WHERE booking_id = ${bookingId} AND status IN ${db(COMMITTED)}`;
    return BigInt(row?.total ?? 0);
  }

  /** REQUESTED → PROCESSING (approved, attempt 1 starts now). */
  async approve(tx: Tx, id: string, approverId: string, note: string | null, at: Date) {
    await tx`
      UPDATE refunds
         SET status = 'PROCESSING', approved_by = ${approverId}, approved_at = ${at},
             decision_note = ${note}, processing_at = ${at}, attempts = attempts + 1
       WHERE id = ${id} AND status = 'REQUESTED'`;
  }

  async reject(tx: Tx, id: string, staffId: string, note: string, at: Date): Promise<void> {
    await tx`
      UPDATE refunds
         SET status = 'REJECTED', rejected_by = ${staffId}, rejected_at = ${at}, decision_note = ${note}
       WHERE id = ${id} AND status = 'REQUESTED'`;
  }

  /** FAILED → PROCESSING: a new gateway attempt (new receipt). */
  async retry(tx: Tx, id: string, at: Date): Promise<void> {
    await tx`
      UPDATE refunds
         SET status = 'PROCESSING', processing_at = ${at}, attempts = attempts + 1,
             failed_at = NULL, failure_reason = NULL, provider_refund_id = NULL
       WHERE id = ${id} AND status = 'FAILED'`;
  }

  async setProviderRefund(tx: Tx, id: string, providerRefundId: string): Promise<void> {
    await tx`
      UPDATE refunds SET provider_refund_id = ${providerRefundId}
      WHERE id = ${id} AND status = 'PROCESSING'`;
  }

  async complete(tx: Tx, id: string, providerRefundId: string, at: Date): Promise<void> {
    await tx`
      UPDATE refunds
         SET status = 'COMPLETED', provider_refund_id = ${providerRefundId}, completed_at = ${at}
       WHERE id = ${id} AND status = 'PROCESSING'`;
  }

  async fail(
    tx: Tx,
    id: string,
    providerRefundId: string | null,
    reason: string,
    at: Date,
  ): Promise<void> {
    await tx`
      UPDATE refunds
         SET status = 'FAILED', provider_refund_id = coalesce(${providerRefundId}, provider_refund_id),
             failed_at = ${at}, failure_reason = ${reason}
       WHERE id = ${id} AND status = 'PROCESSING'`;
  }
}
