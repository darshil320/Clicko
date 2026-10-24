import type { DeliveryLinkKind, QaStatus } from '@clickco/contracts';
import type postgres from 'postgres';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export interface KindCount {
  readonly files: number;
  readonly bytes: number;
}

export interface DeliveryRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly raw: KindCount;
  readonly jpeg: KindCount;
  readonly video: KindCount;
  readonly qaStatus: QaStatus;
  readonly qaAt: Date | null;
  readonly qaNote: string | null;
  readonly releasedAt: Date | null;
  readonly rawExpiresAt: Date | null;
  readonly jpegExpiresAt: Date | null;
}

export interface DeliveryLinkRecord {
  readonly id: string;
  readonly deliveryId: string;
  readonly bookingId: string;
  readonly kind: DeliveryLinkKind;
  readonly publicToken: string;
  readonly providerLink: string;
  readonly providerLinkId: string | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly accessCount: number;
}
