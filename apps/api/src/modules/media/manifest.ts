import {
  countFrames,
  kindForFileName,
  MEDIA_LIMITS,
  type UploadFileDeclaration,
  type UploadFileKind,
} from '@clickco/contracts';

/**
 * Upload manifest rules (ADR-0014 D2) — pure, so the same decisions are unit-tested without a DB.
 * The Zod contract already checked shapes; this checks what a shape cannot: extension ↔ kind, size
 * caps per kind, duplicates, totals, the video flag and the frame count.
 */

export type ManifestProblem =
  | { readonly code: 'VIDEO_UPLOADS_DISABLED'; readonly files: readonly string[] }
  | { readonly code: 'UNSUPPORTED_FILE_TYPE'; readonly files: readonly string[] }
  | { readonly code: 'KIND_MISMATCH'; readonly files: readonly string[] }
  | { readonly code: 'FILE_TOO_LARGE'; readonly files: readonly string[] }
  | { readonly code: 'DUPLICATE_FILE_NAME'; readonly files: readonly string[] }
  | { readonly code: 'DUPLICATE_CLIENT_FILE_ID'; readonly files: readonly string[] }
  | { readonly code: 'SESSION_TOO_LARGE'; readonly declaredBytes: number }
  | {
      readonly code: 'FRAME_COUNT_MISMATCH';
      readonly declared: number;
      readonly detected: number;
    };

export interface ManifestSummary {
  readonly fileCount: number;
  readonly declaredBytes: number;
  readonly frames: number;
}

export type ManifestResult =
  | { readonly ok: true; readonly summary: ManifestSummary }
  | { readonly ok: false; readonly problem: ManifestProblem };

const MAX_LISTED = 20;
const list = (names: readonly string[]): readonly string[] => names.slice(0, MAX_LISTED);

export function maxBytesFor(kind: UploadFileKind): number {
  return kind === 'VIDEO' ? MEDIA_LIMITS.maxVideoBytes : MEDIA_LIMITS.maxPhotoBytes;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

/** The first problem found, in the order a photographer can act on them. */
export function validateManifest(
  files: readonly UploadFileDeclaration[],
  declaredFrameCount: number,
  options: { readonly videoEnabled: boolean },
): ManifestResult {
  const unsupported = files.filter((f) => kindForFileName(f.name) === null).map((f) => f.name);
  if (unsupported.length > 0) {
    return { ok: false, problem: { code: 'UNSUPPORTED_FILE_TYPE', files: list(unsupported) } };
  }
  const mismatched = files.filter((f) => kindForFileName(f.name) !== f.kind).map((f) => f.name);
  if (mismatched.length > 0) {
    return { ok: false, problem: { code: 'KIND_MISMATCH', files: list(mismatched) } };
  }
  const videos = files.filter((f) => f.kind === 'VIDEO').map((f) => f.name);
  if (videos.length > 0 && !options.videoEnabled) {
    return { ok: false, problem: { code: 'VIDEO_UPLOADS_DISABLED', files: list(videos) } };
  }
  const oversize = files.filter((f) => f.sizeBytes > maxBytesFor(f.kind)).map((f) => f.name);
  if (oversize.length > 0) {
    return { ok: false, problem: { code: 'FILE_TOO_LARGE', files: list(oversize) } };
  }
  const dupNames = duplicates(files.map((f) => f.name.toLowerCase()));
  if (dupNames.length > 0) {
    return { ok: false, problem: { code: 'DUPLICATE_FILE_NAME', files: list(dupNames) } };
  }
  const dupIds = duplicates(files.map((f) => f.clientFileId));
  if (dupIds.length > 0) {
    return { ok: false, problem: { code: 'DUPLICATE_CLIENT_FILE_ID', files: list(dupIds) } };
  }
  const declaredBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (declaredBytes > MEDIA_LIMITS.maxSessionBytes) {
    return { ok: false, problem: { code: 'SESSION_TOO_LARGE', declaredBytes } };
  }
  const frames = countFrames(files);
  if (frames !== declaredFrameCount) {
    return {
      ok: false,
      problem: { code: 'FRAME_COUNT_MISMATCH', declared: declaredFrameCount, detected: frames },
    };
  }
  return { ok: true, summary: { fileCount: files.length, declaredBytes, frames } };
}

const MESSAGES: Readonly<Record<ManifestProblem['code'], string>> = {
  VIDEO_UPLOADS_DISABLED: 'Video uploads are not open yet — upload photos only',
  UNSUPPORTED_FILE_TYPE:
    'Only RAW (.cr2 .cr3 .nef .arw .raf .orf .rw2 .dng) and JPEG files can be uploaded',
  KIND_MISMATCH: 'A file’s type does not match its extension',
  FILE_TOO_LARGE: 'A file is larger than the upload limit',
  DUPLICATE_FILE_NAME: 'Two files have the same name — upload each card file once',
  DUPLICATE_CLIENT_FILE_ID: 'Two files share a client file id',
  SESSION_TOO_LARGE: 'This upload is larger than one session allows — split it into two',
  FRAME_COUNT_MISMATCH: 'The declared frame count does not match the photos selected',
};

export const manifestMessage = (p: ManifestProblem): string => MESSAGES[p.code];
