import type { AssetKind, UploadSessionStatus } from '@clickco/contracts';
import type postgres from 'postgres';
import type { SessionDoc } from './session-doc';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export interface UploadSessionRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly photographerId: string;
  readonly origin: string;
  readonly status: UploadSessionStatus;
  readonly declaredFileCount: number;
  readonly declaredBytes: number;
  readonly receivedFileCount: number;
  readonly receivedBytes: number;
  readonly doc: SessionDoc;
  readonly lastActivityAt: Date;
  readonly failureReason: string | null;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

export interface MediaAssetRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly uploadSessionId: string | null;
  readonly kind: AssetKind;
  readonly storageObjectId: string;
  readonly storagePath: string;
  readonly storageAdapter: string;
  readonly originalFilename: string;
  readonly mimeType: string | null;
  readonly sizeBytes: number;
  readonly checksumMd5: string;
  readonly checksumVerifiedAt: Date | null;
  readonly derivedFromAssetId: string | null;
}

export interface NewMediaAsset {
  readonly bookingId: string;
  readonly uploadSessionId: string | null;
  readonly kind: AssetKind;
  readonly storageObjectId: string;
  readonly storagePath: string;
  readonly storageAdapter: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksumMd5: string;
  readonly checksumVerifiedAt: Date;
  readonly derivedFromAssetId: string | null;
  readonly widthPx: number | null;
  readonly heightPx: number | null;
  readonly createdAt: Date;
}

/** What the booking module tells media about one booking (via BookingsService). */
export interface UploadBookingFacts {
  readonly bookingId: string;
  readonly reference: string;
  readonly status: string;
  readonly cityId: string;
  readonly categoryCode: string;
  readonly tier: string;
  readonly scheduledStart: Date;
}

/** What a delivery holds, per kind (ADR-0016 D1). */
export interface DeliveryInventory {
  readonly raw: { readonly files: number; readonly bytes: number };
  readonly jpeg: { readonly files: number; readonly bytes: number };
  readonly video: { readonly files: number; readonly bytes: number };
}
