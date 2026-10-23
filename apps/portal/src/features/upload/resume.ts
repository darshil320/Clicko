import type { UploadFileState, UploadSessionView } from '@clickco/contracts';
import type { CandidateFile } from './file-filter';

/**
 * Resume diffing (doc 02 §7 "Resumable"): the server's session is the truth about which parts
 * landed; the browser re-matches the card files to the manifest after the tab was closed.
 */

/** Same card file = same name, size and last-modified time (what the manifest recorded). */
export const sameFile = (state: UploadFileState, local: CandidateFile): boolean =>
  state.name === local.name &&
  state.sizeBytes === local.size &&
  state.lastModified === local.lastModified;

export interface LocalMatch<T extends CandidateFile> {
  /** clientFileId → the local file to read from. */
  readonly matched: ReadonlyMap<string, T>;
  /** Manifest files still to upload that are not in what was dropped this time. */
  readonly missing: readonly UploadFileState[];
}

/** Matches a re-dropped folder to the files a session still needs (verified files need nothing). */
export function matchLocalFiles<T extends CandidateFile>(
  session: Pick<UploadSessionView, 'files'>,
  local: readonly T[],
): LocalMatch<T> {
  const byName = new Map<string, T[]>();
  for (const f of local) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
  const matched = new Map<string, T>();
  const missing: UploadFileState[] = [];
  for (const state of session.files) {
    if (state.status === 'VERIFIED') continue;
    const hit = (byName.get(state.name) ?? []).find((f) => sameFile(state, f));
    if (hit) matched.set(state.clientFileId, hit);
    else missing.push(state);
  }
  return { matched, missing };
}

export interface ResumeFilePlan {
  readonly clientFileId: string;
  readonly verified: boolean;
  /** partNumber → SHA-256 the server already holds; a local part with the same hash is not re-sent. */
  readonly stored: ReadonlyMap<number, string>;
}

export interface ResumePlan {
  readonly files: readonly ResumeFilePlan[];
  readonly verifiedFiles: number;
  readonly verifiedBytes: number;
  /** Bytes of parts already on the server for unverified files (still re-read and hashed locally). */
  readonly storedPartBytes: number;
}

/** What is left to do for each file of a session, from the server's view of it. */
export function resumePlan(
  session: Pick<UploadSessionView, 'files' | 'partSizeBytes'>,
): ResumePlan {
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  let storedPartBytes = 0;
  const files = session.files.map((f): ResumeFilePlan => {
    if (f.status === 'VERIFIED') {
      verifiedFiles += 1;
      verifiedBytes += f.sizeBytes;
      return { clientFileId: f.clientFileId, verified: true, stored: new Map() };
    }
    for (const p of f.receivedParts) {
      const isLast = p.partNumber === f.partCount;
      storedPartBytes += isLast
        ? f.sizeBytes - session.partSizeBytes * (f.partCount - 1)
        : session.partSizeBytes;
    }
    return {
      clientFileId: f.clientFileId,
      verified: false,
      stored: new Map(f.receivedParts.map((p) => [p.partNumber, p.sha256])),
    };
  });
  return { files, verifiedFiles, verifiedBytes, storedPartBytes };
}
