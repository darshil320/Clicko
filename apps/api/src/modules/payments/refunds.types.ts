import type { InvoiceSplit } from './invoice-split';
import type { PaymentPurpose, PaymentStatus } from './payments.types';

/** A captured payment as a refund sees it (ADR-0026 D1). */
export interface RefundTarget {
  readonly id: string;
  readonly bookingId: string;
  readonly userId: string;
  readonly purpose: PaymentPurpose;
  readonly status: PaymentStatus;
  readonly capturedPaise: bigint;
  readonly refundedPaise: bigint;
  readonly providerPaymentId: string | null;
  readonly invoiceId: string | null;
  readonly method: string | null;
  readonly vpaOrLast4: string | null;
  readonly capturedAt: Date | null;
}

export interface InvoiceForCredit extends InvoiceSplit {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly bookingId: string;
  readonly userId: string;
  readonly sacCode: string;
  readonly placeOfSupply: string;
  readonly issuedAt: Date;
  readonly cancelled: boolean;
}

export interface CreditNoteRecord extends InvoiceSplit {
  readonly id: string;
  readonly number: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly refundId: string | null;
  readonly issuedAt: Date;
  readonly lateForGst: boolean;
}

export interface RecordRefundInput {
  readonly paymentId: string;
  readonly refundId: string;
  readonly amountPaise: bigint;
  readonly reasonCode: string;
  readonly at: Date;
}

/**
 * "9876543210@ybl" → "98•••@ybl": a VPA often holds the client's phone, and the money desks are
 * open to roles that see phones masked (security review M5).
 */
export function maskVpa(vpa: string): string {
  const at = vpa.lastIndexOf('@');
  const local = at > 0 ? vpa.slice(0, at) : vpa;
  const handle = at > 0 ? vpa.slice(at) : '';
  return `${local.slice(0, 2)}•••${handle}`;
}

/** "UPI · an•••@okicici", "Card ending 4242": where a refund goes back, in words. */
export function paidWithLabel(method: string | null, vpaOrLast4: string | null): string {
  const m = method?.toUpperCase() ?? null;
  if (m === 'UPI') return vpaOrLast4 ? `UPI · ${maskVpa(vpaOrLast4)}` : 'UPI';
  if (m === 'CARD') return vpaOrLast4 ? `Card ending ${vpaOrLast4}` : 'Card';
  if (m === 'NETBANKING') return 'Net banking';
  if (m === 'WALLET') return 'Wallet';
  if (m === 'EMI') return 'EMI';
  return 'The original payment method';
}
