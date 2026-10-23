import type postgres from 'postgres';
import type {
  GatewayEvent,
  GatewayName,
  PaymentSucceededEvent,
} from './gateways/payment-gateway.port';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

/** schema §1 payment_purpose / payment_status. */
export type PaymentPurpose = 'ADVANCE' | 'BALANCE' | 'FULL' | 'EXTENSION' | 'EDIT_SERVICE';
export type PaymentStatus =
  | 'CREATED'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'AUTH_RELEASED';

export interface PaymentRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly userId: string;
  readonly purpose: PaymentPurpose;
  readonly status: PaymentStatus;
  readonly amountPaise: bigint;
  readonly capturedPaise: bigint;
  readonly provider: GatewayName;
  readonly providerOrderId: string | null;
  readonly providerPaymentId: string | null;
  readonly isAuthOnly: boolean;
  readonly invoiceId: string | null;
  readonly createdAt: Date;
}

export interface NewPayment {
  readonly bookingId: string;
  readonly userId: string;
  readonly purpose: PaymentPurpose;
  readonly amountPaise: bigint;
  readonly authorizeOnly: boolean;
}

/**
 * What an invoice is split against: the booking's quote snapshot (the bookings module supplies it
 * as SnapshotTotals — payments never reads booking tables).
 */
export interface InvoiceBasis {
  readonly taxablePaise: bigint;
  readonly totalPaise: bigint;
  readonly subtotalPaise: bigint;
  readonly travelPaise: bigint;
  readonly placeOfSupply: string;
  readonly sacCode: string;
}

export interface CaptureInput {
  readonly payment: PaymentRecord;
  readonly event: PaymentSucceededEvent;
  readonly capturedAt: Date;
  /** null = record the money but issue no invoice (booking no longer awaiting payment). */
  readonly invoiceBasis: InvoiceBasis | null;
}

export interface AuthorizationInput {
  readonly payment: PaymentRecord;
  readonly event: PaymentSucceededEvent;
  readonly authorizedAt: Date;
  readonly authExpiresAt: Date;
}

export interface IncomingWebhook {
  /** The :provider route segment. */
  readonly provider: string;
  readonly rawBody: Buffer;
  readonly signature: string | undefined;
  readonly eventId: string | undefined;
}

export type IngestResult =
  | { readonly kind: 'DUPLICATE' }
  /** Validly signed but unparseable: recorded with a note for ops, never applied. */
  | { readonly kind: 'MALFORMED' }
  | { readonly kind: 'NEW'; readonly webhookEventId: string; readonly event: GatewayEvent };

export interface InvoiceRecord {
  readonly id: string;
  readonly invoiceNumber: string;
  readonly purpose: PaymentPurpose;
  readonly taxablePaise: bigint;
  readonly cgstPaise: bigint;
  readonly sgstPaise: bigint;
  readonly igstPaise: bigint;
  readonly totalPaise: bigint;
  readonly issuedAt: Date;
}
