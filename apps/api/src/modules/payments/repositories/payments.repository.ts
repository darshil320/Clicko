import { Injectable } from '@nestjs/common';
import type { GatewayName } from '../gateways/payment-gateway.port';
import type {
  Db,
  NewPayment,
  PaymentPurpose,
  PaymentRecord,
  PaymentStatus,
  Tx,
} from '../payments.types';

const pg = (paise: bigint): string => paise.toString();

interface PaymentRow {
  id: string;
  booking_id: string;
  user_id: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  amount_paise: string;
  captured_paise: string;
  provider: GatewayName;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  is_auth_only: boolean;
  invoice_id: string | null;
  created_at: Date;
}

const toRecord = (r: PaymentRow): PaymentRecord => ({
  id: r.id,
  bookingId: r.booking_id,
  userId: r.user_id,
  purpose: r.purpose,
  status: r.status,
  amountPaise: BigInt(r.amount_paise),
  capturedPaise: BigInt(r.captured_paise),
  provider: r.provider,
  providerOrderId: r.provider_order_id,
  providerPaymentId: r.provider_payment_id,
  isAuthOnly: r.is_auth_only,
  invoiceId: r.invoice_id,
  createdAt: r.created_at,
});

export interface PaymentDetails {
  readonly providerPaymentId: string;
  readonly method: string | null;
  readonly vpaOrLast4: string | null;
}

/** The payments table. Status changes happen only in the caller's transaction. */
@Injectable()
export class PaymentsRepository {
  async insert(
    tx: Tx,
    p: NewPayment & { id: string; provider: GatewayName; providerOrderId: string; createdAt: Date },
  ): Promise<PaymentRecord> {
    const [row] = await tx<PaymentRow[]>`
      INSERT INTO payments (id, booking_id, user_id, purpose, amount_paise, provider,
                            provider_order_id, is_auth_only, created_at)
      VALUES (${p.id}, ${p.bookingId}, ${p.userId}, ${p.purpose}, ${pg(p.amountPaise)},
              ${p.provider}, ${p.providerOrderId}, ${p.authorizeOnly}, ${p.createdAt})
      RETURNING *`;
    if (!row) throw new Error('payments.insert: no row returned');
    return toRecord(row);
  }

  async findById(db: Db, id: string): Promise<PaymentRecord | null> {
    const [row] = await db<PaymentRow[]>`SELECT * FROM payments WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  /** The advance/full order still payable: never captured, never authorised (FAILED can retry). */
  async latestOpenForBooking(db: Db, bookingId: string): Promise<PaymentRecord | null> {
    const [row] = await db<PaymentRow[]>`
      SELECT * FROM payments
      WHERE booking_id = ${bookingId} AND purpose IN ('ADVANCE', 'FULL')
        AND status IN ('CREATED', 'FAILED')
      ORDER BY created_at DESC LIMIT 1`;
    return row ? toRecord(row) : null;
  }

  async lockByOrder(
    tx: Tx,
    provider: GatewayName,
    providerOrderId: string,
  ): Promise<PaymentRecord | null> {
    const [row] = await tx<PaymentRow[]>`
      SELECT * FROM payments WHERE provider = ${provider} AND provider_order_id = ${providerOrderId}
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  async markCaptured(
    tx: Tx,
    id: string,
    d: PaymentDetails & {
      capturedPaise: bigint;
      feePaise: bigint;
      capturedAt: Date;
      invoiceId: string | null;
    },
  ): Promise<void> {
    await tx`
      UPDATE payments
         SET status = 'CAPTURED', captured_paise = ${pg(d.capturedPaise)}, captured_at = ${d.capturedAt},
             gateway_fee_paise = ${pg(d.feePaise)}, provider_payment_id = ${d.providerPaymentId},
             method = ${d.method}, vpa_or_last4 = ${d.vpaOrLast4},
             invoice_id = coalesce(${d.invoiceId}::uuid, invoice_id)
       WHERE id = ${id}`;
  }

  async markAuthorized(
    tx: Tx,
    id: string,
    d: PaymentDetails & { authorizedAt: Date; authExpiresAt: Date },
  ): Promise<void> {
    await tx`
      UPDATE payments
         SET status = 'AUTHORIZED', authorized_at = ${d.authorizedAt}, auth_expires_at = ${d.authExpiresAt},
             provider_payment_id = ${d.providerPaymentId}, method = ${d.method},
             vpa_or_last4 = ${d.vpaOrLast4}
       WHERE id = ${id}`;
  }

  async markFailed(
    tx: Tx,
    id: string,
    d: { failedAt: Date; failureCode: string | null; failureReason: string | null },
  ): Promise<void> {
    await tx`
      UPDATE payments
         SET status = 'FAILED', failed_at = ${d.failedAt}, failure_code = ${d.failureCode},
             failure_reason = ${d.failureReason}
       WHERE id = ${id}`;
  }
}
