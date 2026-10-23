/**
 * The storage port — doc 02 §6, extended for multipart (ADR-0014 D1). Every byte Clickco stores goes
 * through this interface; adapters live in ./adapters and are the only code allowed to import a
 * provider SDK (Invariants 24, 25). Nothing outside infra/storage knows which adapter is live.
 */

/** doc 02 §6 kinds. PROOF = Pro-app proof-of-attendance shots. */
export type StorageKind = 'RAW' | 'JPEG' | 'VIDEO' | 'PROOF';

export type StorageAdapterId = 'LOCAL_DISK' | 'GOOGLE_DRIVE';

/** A byte stream: a Node Readable (an HTTP request, a file) or any async iterable of chunks. */
export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/** Where an object sits in the provider-agnostic folder layout (doc 02 §6). */
export interface ObjectLocation {
  readonly bookingId: string;
  /** e.g. CK-7K2M9Q — the booking folder name. */
  readonly bookingRef: string;
  /** YYYY-MM (IST) of the booking's scheduled start. */
  readonly yearMonth: string;
  /** Below the booking folder, e.g. `Photos-RAW/part-01/IMG_0001.CR3` (see folder-layout.ts). */
  readonly relativePath: string;
}

export interface CreateUploadSessionInput extends ObjectLocation {
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly kind: StorageKind;
  /** Every part but the last is exactly this size. */
  readonly partSizeBytes: number;
}

export interface UploadSessionHandle {
  readonly sessionId: string;
  /** Adapter-internal (a Drive resumable URI, a local staging path). Never sent to a browser. */
  readonly uploadUrl: string;
  readonly expiresAt: Date;
}

/** At least one of `sha256` / `md5Base64` is required; every one given is verified. */
export interface PartExpectation {
  readonly sizeBytes: number;
  /** Lower-case hex SHA-256 the received bytes must match (the portal's X-Part-Sha256). */
  readonly sha256?: string;
  /** Base64 MD5 the received bytes must match (an HTTP Content-MD5 header). */
  readonly md5Base64?: string;
}

export interface PartReceipt {
  readonly partNumber: number;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface StoredObject {
  /** Adapter-generated and unique (Drive file id, local uuid, later an R2 key). */
  readonly objectId: string;
  readonly bookingId: string;
  /** The logical path `Clickco/{YYYY-MM}/{booking_ref}/…`. */
  readonly path: string;
  readonly kind: StorageKind;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Lower-case hex MD5 as the provider reports it (media_assets.checksum_md5). */
  readonly md5: string;
  /** Lower-case hex SHA-256 when Clickco computed it while writing. */
  readonly sha256: string | null;
  readonly createdAt: Date;
}

export interface PutObjectInput extends ObjectLocation {
  readonly fileName: string;
  readonly contentType: string;
  readonly kind: StorageKind;
  /** The write fails (and keeps nothing) unless exactly this many bytes arrive. */
  readonly sizeBytes: number;
}

export interface StorageUsage {
  readonly usedBytes: number;
  readonly limitBytes: number;
  /** Bytes written in the rolling last 24 h (UploadBudget). */
  readonly dailyUploadedBytes: number;
  /** Provider daily upload ceiling; null when there is none (local disk without a configured cap). */
  readonly dailyLimitBytes: number | null;
}

export interface DeliveryLink {
  readonly url: string;
  readonly linkId: string;
}

export interface StoragePort {
  readonly adapterId: StorageAdapterId;

  // ── doc 02 §6 ────────────────────────────────────────────────────────────
  createUploadSession(input: CreateUploadSessionInput): Promise<UploadSessionHandle>;
  /**
   * Assembles the parts in order, hashing as it goes. `checksum` is the expected lower-case hex
   * SHA-256 of the whole file. On mismatch throws ChecksumMismatchError and discards the parts.
   */
  completeUpload(sessionId: string, checksum: string): Promise<StoredObject>;
  /** Idempotent: aborting a missing session is a no-op. */
  abortUpload(sessionId: string): Promise<void>;
  createDeliveryLink(
    bookingId: string,
    kind: 'RAW' | 'JPEG' | 'VIDEO',
    expiresAt: Date,
  ): Promise<DeliveryLink>;
  /** Idempotent for a revoked link; StorageNotFoundError for an unknown one. */
  revokeDeliveryLink(linkId: string): Promise<void>;
  /** PERMANENT delete — never trash (Invariant 6). Unknown ids are ignored. */
  permanentlyDelete(objectIds: readonly string[]): Promise<void>;
  getUsage(): Promise<StorageUsage>;
  listObjects(bookingId: string): Promise<StoredObject[]>;

  // ── ADR-0014 D1 additions ─────────────────────────────────────────────────
  /**
   * Streams one part. Size and hash are checked before the part is kept (PartSizeMismatchError,
   * PartChecksumMismatchError ⇒ nothing stored). Re-putting a part replaces it atomically.
   */
  uploadPart(
    sessionId: string,
    partNumber: number,
    body: ByteSource,
    expect: PartExpectation,
  ): Promise<PartReceipt>;
  listParts(sessionId: string): Promise<PartReceipt[]>;
  /** Single-shot write for server-produced files (exported JPEGs, proof shots). */
  putObject(input: PutObjectInput, body: ByteSource): Promise<StoredObject>;
  /** Reads an object back (JPEG export, audits). StorageNotFoundError when absent. */
  openObject(objectId: string): Promise<ByteSource>;
}

export const STORAGE_PORT = Symbol('STORAGE_PORT');
