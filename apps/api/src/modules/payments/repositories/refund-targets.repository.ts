import { Injectable } from '@nestjs/common';
import type { Db, PaymentPurpose, PaymentStatus, Tx } from '../payments.types';
import type { RefundTarget } from '../refunds.types';

const pg = (paise: bigint): string => paise.toString();

interface Row {
  id: string;
  booking_id: string;
  user_id: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  captured_paise: string;
  refunded_paise: string;
  provider_payment_id: string | null;
  invoice_id: string | null;
  method: string | null;
  vpa_or_last4: string | null;
  captured_at: Date | null;
}

const COLUMNS = `id, booking_id, user_id, purpose, status, captured_paise, refunded_paise,
  provider_payment_id, invoice_id, method, vpa_or_last4, captured_at`;

const toTarget = (r: Row): RefundTarget => ({
  id: r.id,
  bookingId: r.booking_id,
  userId: r.user_id,
  purpose: r.purpose,
  status: r.status,
  capturedPaise: BigInt(r.captured_paise),
  refundedPaise: BigInt(r.refunded_paise),
  providerPaymentId: r.provider_payment_id,
  invoiceId: r.invoice_id,
  method: r.method,
  vpaOrLast4: r.vpa_or_last4,
  capturedAt: r.captured_at,
});

/** The payments table as refunds see it (ADR-0026 D1): captured money and what went back. */
@Injectable()
export class RefundTargetsRepository {
  /** Every payment of a booking that ever captured money, oldest first. */
  async forBooking(db: Db, bookingId: string): Promise<RefundTarget[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM payments
      WHERE booking_id = ${bookingId} AND captured_paise > 0
      ORDER BY captured_at NULLS LAST, created_at, id`;
    return rows.map(toTarget);
  }

  async byIds(db: Db, ids: readonly string[]): Promise<RefundTarget[]> {
    if (ids.length === 0) return [];
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM payments WHERE id IN ${db([...new Set(ids)])}`;
    return rows.map(toTarget);
  }

  async idByProviderPayment(
    db: Db,
    provider: string,
    providerPaymentId: string,
  ): Promise<string | null> {
    const [row] = await db<{ id: string }[]>`
      SELECT id FROM payments
      WHERE provider = ${provider} AND provider_payment_id = ${providerPaymentId}`;
    return row?.id ?? null;
  }

  async lock(tx: Tx, id: string): Promise<RefundTarget | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM payments WHERE id = ${id} FOR UPDATE`;
    return row ? toTarget(row) : null;
  }

  /** refunded += amount (never past captured: the payment_amounts CHECK agrees). */
  async addRefunded(tx: Tx, id: string, amountPaise: bigint): Promise<boolean> {
    const rows = await tx`
      UPDATE payments
         SET refunded_paise = refunded_paise + ${pg(amountPaise)}::bigint,
             status = CASE WHEN refunded_paise + ${pg(amountPaise)}::bigint = captured_paise
                           THEN 'REFUNDED'::payment_status
                           ELSE 'PARTIALLY_REFUNDED'::payment_status END
       WHERE id = ${id} AND refunded_paise + ${pg(amountPaise)}::bigint <= captured_paise
       RETURNING id`;
    return rows.length === 1;
  }
}
