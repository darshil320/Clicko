import {
  partCountFor,
  type UploadFileDeclaration,
  type UploadFileKind,
  type UploadFileState,
  type UploadFileStatus,
} from '@clickco/contracts';

/**
 * `upload_sessions.completed_parts` — the resumability document (ADR-0014 D2). Pure helpers: the
 * repository writes it with jsonb_set, these read and build it.
 */

export const SESSION_DOC_VERSION = 1;

export interface SessionFileDoc {
  readonly name: string;
  readonly kind: UploadFileKind;
  readonly sizeBytes: number;
  readonly lastModified: number;
  readonly partCount: number;
  /** Below the booking folder, e.g. Photos-RAW/part-01 (folder-layout.ts). */
  readonly folder: string;
  /** The StoragePort upload session for this file (replaced when the file restarts). */
  readonly storageSessionId: string;
  /** partNumber → lower-case hex SHA-256 of the part as stored. */
  readonly parts: Readonly<Record<string, string>>;
  readonly status: UploadFileStatus;
  readonly sha256: string | null;
  readonly assetId: string | null;
}

export interface SessionDoc {
  readonly v: number;
  readonly partSizeBytes: number;
  readonly declaredFrameCount: number;
  /** What the photographer declared at check-out (ADR-0013 D7), for QA; null if not recorded. */
  readonly checkoutDeclaredFrames: number | null;
  readonly files: Readonly<Record<string, SessionFileDoc>>;
}

export interface FilePlan {
  readonly declaration: UploadFileDeclaration;
  readonly folder: string;
  readonly storageSessionId: string;
}

export function buildSessionDoc(input: {
  readonly partSizeBytes: number;
  readonly declaredFrameCount: number;
  readonly checkoutDeclaredFrames: number | null;
  readonly files: readonly FilePlan[];
}): SessionDoc {
  const files: Record<string, SessionFileDoc> = {};
  for (const f of input.files) {
    const d = f.declaration;
    files[d.clientFileId] = {
      name: d.name,
      kind: d.kind,
      sizeBytes: d.sizeBytes,
      lastModified: d.lastModified,
      partCount: partCountFor(d.sizeBytes, input.partSizeBytes),
      folder: f.folder,
      storageSessionId: f.storageSessionId,
      parts: {},
      status: 'PENDING',
      sha256: null,
      assetId: null,
    };
  }
  return {
    v: SESSION_DOC_VERSION,
    partSizeBytes: input.partSizeBytes,
    declaredFrameCount: input.declaredFrameCount,
    checkoutDeclaredFrames: input.checkoutDeclaredFrames,
    files,
  };
}

/** Bytes part `partNumber` must have: the part size, except the remainder in the last part. */
export function expectedPartSize(file: SessionFileDoc, partSizeBytes: number, partNumber: number) {
  return partNumber < file.partCount
    ? partSizeBytes
    : file.sizeBytes - partSizeBytes * (file.partCount - 1);
}

/** Part numbers 1..partCount not yet recorded. */
export function missingParts(file: SessionFileDoc): number[] {
  const missing: number[] = [];
  for (let n = 1; n <= file.partCount; n++)
    if (file.parts[String(n)] === undefined) missing.push(n);
  return missing;
}

export function fileState(clientFileId: string, f: SessionFileDoc): UploadFileState {
  return {
    clientFileId,
    name: f.name,
    kind: f.kind,
    sizeBytes: f.sizeBytes,
    lastModified: f.lastModified,
    partCount: f.partCount,
    status: f.status,
    receivedParts: Object.entries(f.parts)
      .map(([n, sha256]) => ({ partNumber: Number.parseInt(n, 10), sha256 }))
      .sort((a, b) => a.partNumber - b.partNumber),
    sha256: f.sha256,
    assetId: f.assetId,
  };
}

/** Files in manifest order is not preserved by jsonb; sort by name for a stable resume view. */
export function fileStates(doc: SessionDoc): UploadFileState[] {
  return Object.entries(doc.files)
    .map(([id, f]) => fileState(id, f))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function unverifiedFiles(doc: SessionDoc): string[] {
  return Object.entries(doc.files)
    .filter(([, f]) => f.status !== 'VERIFIED')
    .map(([id]) => id);
}
