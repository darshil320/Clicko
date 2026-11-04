/**
 * The portal's upload, from Node: the same routes in the same order as
 * apps/portal/src/features/upload (create session → PUT each part with its SHA-256 → complete
 * each file with the whole-file SHA-256 → complete the session). The files are synthetic but
 * carry real format signatures (the API checks a file's first bytes against its extension).
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  AbortUploadSessionResponse,
  CompleteUploadFileResponse,
  CompleteUploadSessionResponse,
  newIdempotencyKey,
  rawCall,
  UploadPartResponse,
  UploadSessionView,
} from './sdk.js';

const KIB = 1024;
const MIB = 1024 * KIB;

export interface SyntheticFile {
  readonly clientFileId: string;
  readonly name: string;
  readonly kind: 'RAW_PHOTO' | 'JPEG_PHOTO';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

const TIFF_LE = [0x49, 0x49, 0x2a, 0x00];
const JPEG_SOI = [0xff, 0xd8, 0xff, 0xe0];

function synthetic(name: string, kind: SyntheticFile['kind'], size: number): SyntheticFile {
  const body = randomBytes(size);
  body.set(kind === 'RAW_PHOTO' ? TIFF_LE : JPEG_SOI, 0);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const clientFileId = name.replace(/[^A-Za-z0-9_-]/g, '_');
  return { clientFileId, name, kind, bytes: new Uint8Array(body), sha256 };
}

/** Two frames (RAW + JPEG each). The first RAW spans two 8 MiB parts, to exercise multipart. */
export function syntheticCard(): readonly SyntheticFile[] {
  return [
    synthetic('DRY_0001.DNG', 'RAW_PHOTO', 9 * MIB),
    synthetic('DRY_0001.JPG', 'JPEG_PHOTO', 256 * KIB),
    synthetic('DRY_0002.DNG', 'RAW_PHOTO', 512 * KIB),
    synthetic('DRY_0002.JPG', 'JPEG_PHOTO', 128 * KIB),
  ];
}

export const FRAME_COUNT = 2;

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface UploadResult {
  readonly sessionId: string;
  readonly parts: number;
  readonly bytes: number;
  readonly bookingStatus: string;
  readonly receivedFileCount: number;
}

const openSession = (
  baseUrl: string,
  token: string,
  bookingId: string,
  files: readonly SyntheticFile[],
) =>
  rawCall(baseUrl, {
    method: 'POST',
    path: `/pro/bookings/${bookingId}/upload-sessions`,
    schema: UploadSessionView,
    token,
    idempotencyKey: newIdempotencyKey(),
    json: {
      declaredFrameCount: FRAME_COUNT,
      files: files.map((f) => ({
        clientFileId: f.clientFileId,
        name: f.name,
        sizeBytes: f.bytes.length,
        kind: f.kind,
        lastModified: Date.now(),
      })),
    },
  });

/**
 * A run resumed after a failed upload finds its earlier session still open (409
 * UPLOAD_SESSION_ACTIVE): abort it, as the portal's "start again" does, and open a fresh one.
 */
async function openFreshSession(
  baseUrl: string,
  token: string,
  bookingId: string,
  files: readonly SyntheticFile[],
) {
  try {
    return await openSession(baseUrl, token, bookingId, files);
  } catch (error) {
    const stale = (error as { code?: string; details?: { sessionId?: unknown } }) ?? {};
    if (stale.code !== 'UPLOAD_SESSION_ACTIVE' || typeof stale.details?.sessionId !== 'string') {
      throw error;
    }
    await rawCall(baseUrl, {
      method: 'POST',
      path: `/pro/upload-sessions/${stale.details.sessionId}/abort`,
      schema: AbortUploadSessionResponse,
      token,
      idempotencyKey: newIdempotencyKey(),
    });
    return openSession(baseUrl, token, bookingId, files);
  }
}

export async function uploadCard(
  baseUrl: string,
  token: string,
  bookingId: string,
  files: readonly SyntheticFile[],
): Promise<UploadResult> {
  const session = await openFreshSession(baseUrl, token, bookingId, files);
  const partSize = session.partSizeBytes;
  let parts = 0;
  for (const file of files) {
    for (let start = 0, n = 1; start < file.bytes.length; start += partSize, n++) {
      const bytes = file.bytes.subarray(start, Math.min(start + partSize, file.bytes.length));
      await rawCall(baseUrl, {
        method: 'PUT',
        path: `/pro/upload-sessions/${session.sessionId}/files/${file.clientFileId}/parts/${n}`,
        schema: UploadPartResponse,
        token,
        bytes,
        headers: { 'x-part-sha256': sha256Hex(bytes) },
      });
      parts += 1;
    }
    await rawCall(baseUrl, {
      method: 'POST',
      path: `/pro/upload-sessions/${session.sessionId}/files/${file.clientFileId}/complete`,
      schema: CompleteUploadFileResponse,
      token,
      idempotencyKey: newIdempotencyKey(),
      json: { sha256: file.sha256 },
    });
  }
  const done = await rawCall(baseUrl, {
    method: 'POST',
    path: `/pro/upload-sessions/${session.sessionId}/complete`,
    schema: CompleteUploadSessionResponse,
    token,
    idempotencyKey: newIdempotencyKey(),
  });
  return {
    sessionId: session.sessionId,
    parts,
    bytes: done.receivedBytes,
    bookingStatus: done.bookingStatus,
    receivedFileCount: done.receivedFileCount,
  };
}
