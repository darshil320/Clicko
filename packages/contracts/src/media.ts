import { z } from 'zod';
import { IsoDateTime, Uuid } from './common.js';
import { BookingStatus, PlanTier } from './enums.js';

/**
 * Media upload (ADR-0014). The web portal (doc 02 §7) uploads every RAW/JPEG/video byte through these
 * routes; the API owns storage (StoragePort) and never hands a browser a provider URL.
 */

// ── Enums mirrored from docs/clickco-04-schema.sql §1 ───────────────────────

export const AssetKind = z.enum(['RAW_PHOTO', 'JPEG_PHOTO', 'VIDEO', 'PROOF_SHOT']);
export type AssetKind = z.infer<typeof AssetKind>;

export const UploadSessionStatus = z.enum([
  'OPEN',
  'UPLOADING',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'ABORTED',
]);
export type UploadSessionStatus = z.infer<typeof UploadSessionStatus>;

/** What a photographer can upload from the portal (proof shots come from the Pro app). */
export const UploadFileKind = z.enum(['RAW_PHOTO', 'JPEG_PHOTO', 'VIDEO']);
export type UploadFileKind = z.infer<typeof UploadFileKind>;

// ── Limits shared by the portal and the API ─────────────────────────────────

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const MEDIA_LIMITS = {
  /** Server-dictated part size (doc 02 §7: 8–16 MB parts for broadband). */
  partSizeBytes: 8 * MIB,
  /** The parts route refuses any body above this. */
  maxPartBytes: 16 * MIB,
  maxPhotoBytes: 200 * MIB,
  maxVideoBytes: 8 * GIB,
  maxFilesPerSession: 3_000,
  maxSessionBytes: 200 * GIB,
  maxFileNameLength: 200,
  /** Photographer-facing upload deadline after check-out (ADR-0004). */
  uploadDeadlineHours: 6,
  /** Parts in flight per browser (doc 02 §7). */
  concurrentParts: 4,
  /** Retry delays on 5xx / 429 / network errors, then the error is surfaced (doc 02 §7). */
  backoffScheduleMs: [1_000, 2_000, 4_000, 8_000, 16_000],
} as const;

/** Lower-case, with the dot. */
export const RAW_EXTENSIONS = [
  '.cr2',
  '.cr3',
  '.nef',
  '.arw',
  '.raf',
  '.orf',
  '.rw2',
  '.dng',
] as const;
export const JPEG_EXTENSIONS = ['.jpg', '.jpeg'] as const;
/** Camera-original compressed video (v0.2 §3.1). Accepted only while feature flag `video_uploads` is on. */
export const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v', '.mts'] as const;

/** The extension of a file name, lower-case with the dot ('' when there is none). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot).toLowerCase();
}

/** The upload kind a file name implies, or null for anything we do not accept. */
export function kindForFileName(name: string): UploadFileKind | null {
  const ext = fileExtension(name);
  if ((RAW_EXTENSIONS as readonly string[]).includes(ext)) return 'RAW_PHOTO';
  if ((JPEG_EXTENSIONS as readonly string[]).includes(ext)) return 'JPEG_PHOTO';
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'VIDEO';
  return null;
}

/** The frame a photo belongs to: its stem, case-insensitive (IMG_0001.CR3 + IMG_0001.JPG = one frame). */
export function frameStem(name: string): string {
  const dot = name.lastIndexOf('.');
  return (dot <= 0 ? name : name.slice(0, dot)).toLowerCase();
}

/** Distinct frames among the photo files of a manifest (videos are not frames). */
export function countFrames(
  files: ReadonlyArray<{ readonly name: string; readonly kind: UploadFileKind }>,
): number {
  return new Set(files.filter((f) => f.kind !== 'VIDEO').map((f) => frameStem(f.name))).size;
}

/** Number of parts a file of `sizeBytes` is split into. */
export function partCountFor(sizeBytes: number, partSizeBytes: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSizeBytes));
}

// ── Shapes ──────────────────────────────────────────────────────────────────

/** Names an object already has: as a key of the session document they would shadow it (L2). */
const RESERVED_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).concat('prototype'));

export const ClientFileId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1–64 of A–Z a–z 0–9 _ -')
  .refine((id) => !RESERVED_KEYS.has(id), 'is a reserved name');
export type ClientFileId = z.infer<typeof ClientFileId>;

/** Lower-case hex SHA-256. */
export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a lower-case hex SHA-256');
export type Sha256Hex = z.infer<typeof Sha256Hex>;

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
const UNSAFE_NAME = /[/\\\u0000-\u001f\u007f]/;

export const UploadFileName = z
  .string()
  .min(1)
  .max(MEDIA_LIMITS.maxFileNameLength)
  .refine((n) => !UNSAFE_NAME.test(n), 'must not contain path separators or control characters')
  .refine((n) => n !== '.' && n !== '..' && !n.startsWith('.'), 'must not be a hidden file');

export const UploadFileDeclaration = z.object({
  clientFileId: ClientFileId,
  name: UploadFileName,
  sizeBytes: z.int().min(1).max(MEDIA_LIMITS.maxVideoBytes),
  kind: UploadFileKind,
  /** File.lastModified (ms since epoch) — lets a resumed browser match the same card file. */
  lastModified: z.int().min(0),
});
export type UploadFileDeclaration = z.infer<typeof UploadFileDeclaration>;

/** POST /pro/bookings/:bookingId/upload-sessions */
export const CreateUploadSessionBody = z.object({
  files: z.array(UploadFileDeclaration).min(1).max(MEDIA_LIMITS.maxFilesPerSession),
  declaredFrameCount: z.int().min(0).max(100_000),
});
export type CreateUploadSessionBody = z.infer<typeof CreateUploadSessionBody>;

export const UploadFileStatus = z.enum(['PENDING', 'VERIFIED']);
export type UploadFileStatus = z.infer<typeof UploadFileStatus>;

export const ReceivedPart = z.object({ partNumber: z.int().min(1), sha256: Sha256Hex });
export type ReceivedPart = z.infer<typeof ReceivedPart>;

export const UploadFileState = z.object({
  clientFileId: ClientFileId,
  name: z.string(),
  kind: UploadFileKind,
  sizeBytes: z.int().min(1),
  lastModified: z.int().min(0),
  partCount: z.int().min(1),
  status: UploadFileStatus,
  receivedParts: z.array(ReceivedPart),
  sha256: Sha256Hex.nullable(),
  assetId: Uuid.nullable(),
});
export type UploadFileState = z.infer<typeof UploadFileState>;

/** GET /pro/upload-sessions/:id — everything a browser needs to resume. */
export const UploadSessionView = z.object({
  sessionId: Uuid,
  bookingId: Uuid,
  status: UploadSessionStatus,
  partSizeBytes: z.int().min(1),
  declaredFrameCount: z.int().min(0),
  declaredFileCount: z.int().min(0),
  declaredBytes: z.int().min(0),
  receivedFileCount: z.int().min(0),
  receivedBytes: z.int().min(0),
  startedAt: IsoDateTime,
  lastActivityAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  failureReason: z.string().nullable(),
  files: z.array(UploadFileState),
});
export type UploadSessionView = z.infer<typeof UploadSessionView>;

/** PUT /pro/upload-sessions/:id/files/:fileId/parts/:partNumber (raw body). */
export const UploadPartResponse = z.object({
  partNumber: z.int().min(1),
  sizeBytes: z.int().min(1),
  sha256: Sha256Hex,
  /** The same bytes were already stored: nothing was rewritten. */
  alreadyStored: z.boolean(),
});
export type UploadPartResponse = z.infer<typeof UploadPartResponse>;

/** POST /pro/upload-sessions/:id/files/:fileId/complete */
export const CompleteUploadFileBody = z.object({ sha256: Sha256Hex });
export type CompleteUploadFileBody = z.infer<typeof CompleteUploadFileBody>;

export const CompleteUploadFileResponse = z.object({
  clientFileId: ClientFileId,
  status: z.literal('VERIFIED'),
  assetId: Uuid,
  sizeBytes: z.int().min(1),
  sha256: Sha256Hex,
  receivedFileCount: z.int().min(0),
  declaredFileCount: z.int().min(0),
});
export type CompleteUploadFileResponse = z.infer<typeof CompleteUploadFileResponse>;

/** POST /pro/upload-sessions/:id/complete */
export const CompleteUploadSessionResponse = z.object({
  sessionId: Uuid,
  bookingId: Uuid,
  status: z.literal('COMPLETED'),
  bookingStatus: BookingStatus,
  receivedFileCount: z.int().min(0),
  receivedBytes: z.int().min(0),
});
export type CompleteUploadSessionResponse = z.infer<typeof CompleteUploadSessionResponse>;

/** POST /pro/upload-sessions/:id/abort */
export const AbortUploadSessionResponse = z.object({
  sessionId: Uuid,
  status: z.literal('ABORTED'),
});
export type AbortUploadSessionResponse = z.infer<typeof AbortUploadSessionResponse>;

export const UploadSessionSummary = z.object({
  sessionId: Uuid,
  status: UploadSessionStatus,
  declaredFileCount: z.int().min(0),
  receivedFileCount: z.int().min(0),
  declaredBytes: z.int().min(0),
  receivedBytes: z.int().min(0),
  startedAt: IsoDateTime,
  lastActivityAt: IsoDateTime,
});
export type UploadSessionSummary = z.infer<typeof UploadSessionSummary>;

/** GET /pro/upload-jobs item: a shoot that is waiting for (or past) its upload. */
export const ProUploadJob = z.object({
  bookingId: Uuid,
  assignmentId: Uuid,
  bookingReference: z.string(),
  bookingStatus: BookingStatus,
  categoryCode: z.string(),
  tier: PlanTier,
  scheduledStart: IsoDateTime,
  /** T0: when the booking was checked out (null only if the timeline is missing it). */
  checkedOutAt: IsoDateTime.nullable(),
  /** checkedOutAt + MEDIA_LIMITS.uploadDeadlineHours. */
  uploadDeadlineAt: IsoDateTime.nullable(),
  activeSession: UploadSessionSummary.nullable(),
  media: z.object({
    rawFiles: z.int().min(0),
    jpegFiles: z.int().min(0),
    videoFiles: z.int().min(0),
    exportedJpegs: z.int().min(0),
    uploadedBytes: z.int().min(0),
  }),
});
export type ProUploadJob = z.infer<typeof ProUploadJob>;
