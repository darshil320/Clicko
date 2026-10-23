import type { Clock } from '../../../common/clock';
import { StorageNotConfiguredError } from '../storage.errors';
import type {
  ByteSource,
  CreateUploadSessionInput,
  DeliveryLink,
  PartExpectation,
  PartReceipt,
  PutObjectInput,
  StoragePort,
  StorageUsage,
  StoredObject,
  UploadSessionHandle,
} from '../storage.port';
import type { UploadBudget } from '../upload-budget';

/** Drive's per-account upload ceiling (v0.2 §4: ~750 GB/day). */
export const DRIVE_DAILY_UPLOAD_LIMIT_BYTES = 750 * 1000 * 1000 * 1000;
/** A 5 TB Shared Drive (ADR-0001). */
export const DRIVE_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024 * 1024 * 1024;

export interface GoogleDriveOptions {
  readonly sharedDriveId: string | null;
  readonly serviceAccountJsonBase64: string | null;
}

const NOT_YET =
  'The Google Drive adapter is not implemented yet: it lands with the Shared Drive + service ' +
  'account (PLAN B10, the Sprint 7 gate). Use STORAGE_ADAPTER=local in development.';

/**
 * Typed skeleton (ADR-0014 D1). Every method throws StorageNotConfiguredError until B10 — the API
 * still boots, and media routes answer 503 STORAGE_NOT_CONFIGURED.
 *
 * The implementation must pass `__tests__/storage-port.contract.ts` and must:
 *  1. Stage parts on the API volume, then push the assembled file with a Drive resumable upload —
 *     Drive accepts chunks only in order, so parallel browser parts cannot be forwarded live.
 *  2. Make EVERY Drive call through one rate-limited BullMQ `drive` queue (Invariant 24), with
 *     exponential backoff on `403 rateLimitExceeded` / `userRateLimitExceeded` and `429`
 *     (honour `Retry-After`).
 *  3. Compare the locally computed MD5 with Drive's returned `md5Checksum` on every file; on mismatch
 *     re-upload and never report the object complete.
 *  4. Delete with `files.delete` (`supportsAllDrives: true`) — NEVER `files.update{trashed:true}`:
 *     trash consumes the 5 TB for 30 days (Invariant 6).
 *  5. Record every uploaded byte in UploadBudget and report `dailyLimitBytes` =
 *     DRIVE_DAILY_UPLOAD_LIMIT_BYTES (MediaService refuses new sessions past 85 %).
 *  6. Write only into the service-account-owned Shared Drive (`sharedDriveId`), never a personal
 *     Drive; create `Clickco/{YYYY-MM}/{booking_ref}/{Photos-JPEG|Photos-RAW/part-NN|Video}/` and keep
 *     RAW part folders ≤ 2 GB (folder-layout.ts already plans them).
 *  7. Serve `openObject` from the staging cache while the assembled file is still there.
 *  8. Create delivery links as restricted, revocable permissions; revoke by deleting the permission.
 * `googleapis` may be imported in this directory only (the repo guard enforces it).
 */
export class GoogleDriveAdapter implements StoragePort {
  readonly adapterId = 'GOOGLE_DRIVE' as const;

  constructor(
    readonly options: GoogleDriveOptions,
    readonly budget: UploadBudget,
    readonly clock: Clock,
  ) {}

  private notConfigured(): never {
    throw new StorageNotConfiguredError(NOT_YET);
  }

  async createUploadSession(_input: CreateUploadSessionInput): Promise<UploadSessionHandle> {
    return this.notConfigured();
  }

  async uploadPart(
    _sessionId: string,
    _partNumber: number,
    _body: ByteSource,
    _expect: PartExpectation,
  ): Promise<PartReceipt> {
    return this.notConfigured();
  }

  async listParts(_sessionId: string): Promise<PartReceipt[]> {
    return this.notConfigured();
  }

  async completeUpload(_sessionId: string, _checksum: string): Promise<StoredObject> {
    return this.notConfigured();
  }

  async abortUpload(_sessionId: string): Promise<void> {
    return this.notConfigured();
  }

  async putObject(_input: PutObjectInput, _body: ByteSource): Promise<StoredObject> {
    return this.notConfigured();
  }

  async openObject(_objectId: string): Promise<ByteSource> {
    return this.notConfigured();
  }

  async createDeliveryLink(
    _bookingId: string,
    _kind: 'RAW' | 'JPEG' | 'VIDEO',
    _expiresAt: Date,
  ): Promise<DeliveryLink> {
    return this.notConfigured();
  }

  async revokeDeliveryLink(_linkId: string): Promise<void> {
    return this.notConfigured();
  }

  async permanentlyDelete(_objectIds: readonly string[]): Promise<void> {
    return this.notConfigured();
  }

  async getUsage(): Promise<StorageUsage> {
    return this.notConfigured();
  }

  async listObjects(_bookingId: string): Promise<StoredObject[]> {
    return this.notConfigured();
  }
}
