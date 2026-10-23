import {
  countFrames,
  kindForFileName,
  MEDIA_LIMITS,
  type UploadFileKind,
} from '@clickco/contracts';

/**
 * Which dropped files are uploaded (doc 02 §7 "Folder drop"): known RAW / JPEG (/ video when the
 * flag is on) extensions only, each rejection with a reason the photographer can act on.
 */

export interface CandidateFile {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  /** Where it was inside the dropped folder, for messages (e.g. DCIM/100CANON/IMG_0001.CR3). */
  readonly path?: string;
}

export type RejectionReason =
  | 'HIDDEN'
  | 'UNSUPPORTED_TYPE'
  | 'VIDEO_DISABLED'
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'NAME_TOO_LONG'
  | 'DUPLICATE'
  | 'NAME_CLASH';

export interface Rejection {
  readonly name: string;
  readonly path: string;
  readonly reason: RejectionReason;
  readonly message: string;
}

export interface AcceptedFile<T extends CandidateFile> {
  readonly file: T;
  readonly kind: UploadFileKind;
}

export interface FilterResult<T extends CandidateFile> {
  readonly accepted: ReadonlyArray<AcceptedFile<T>>;
  readonly rejected: readonly Rejection[];
}

const MIB = 1024 * 1024;

/* biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point */
const UNSAFE = /[/\\\u0000-\u001f\u007f]/;

function reject(f: CandidateFile, reason: RejectionReason, message: string): Rejection {
  return { name: f.name, path: f.path ?? f.name, reason, message };
}

function check(f: CandidateFile, videoEnabled: boolean): Rejection | UploadFileKind {
  // macOS AppleDouble (._IMG_0001.CR3) and other dot files ride along on cards; never photos.
  if (f.name.startsWith('.')) return reject(f, 'HIDDEN', 'Hidden system file — skipped');
  if (f.name.length > MEDIA_LIMITS.maxFileNameLength || UNSAFE.test(f.name)) {
    return reject(
      f,
      'NAME_TOO_LONG',
      'File name is too long or has unusual characters — rename it',
    );
  }
  const kind = kindForFileName(f.name);
  if (kind === null) {
    return reject(
      f,
      'UNSUPPORTED_TYPE',
      'Not a RAW or JPEG photo — only camera files are uploaded',
    );
  }
  if (kind === 'VIDEO' && !videoEnabled) {
    return reject(f, 'VIDEO_DISABLED', 'Video uploads are not open yet — photos only');
  }
  if (f.size === 0) return reject(f, 'EMPTY', 'Empty file (0 bytes) — check the card');
  const max = kind === 'VIDEO' ? MEDIA_LIMITS.maxVideoBytes : MEDIA_LIMITS.maxPhotoBytes;
  if (f.size > max) {
    return reject(f, 'TOO_LARGE', `Larger than the ${max / MIB} MB limit for one file`);
  }
  return kind;
}

/**
 * Filters a drop (in the order given). Identical copies (same name, size and timestamp — a dual-card
 * backup) are kept once; two different files with one name cannot both be uploaded.
 */
export function filterFiles<T extends CandidateFile>(
  files: readonly T[],
  options: { readonly videoEnabled: boolean },
): FilterResult<T> {
  const accepted: Array<AcceptedFile<T>> = [];
  const rejected: Rejection[] = [];
  const byName = new Map<string, T>();
  for (const f of files) {
    const verdict = check(f, options.videoEnabled);
    if (typeof verdict !== 'string') {
      rejected.push(verdict);
      continue;
    }
    const key = f.name.toLowerCase();
    const seen = byName.get(key);
    if (seen) {
      rejected.push(
        seen.size === f.size && seen.lastModified === f.lastModified
          ? reject(f, 'DUPLICATE', 'Same file selected twice (backup card?) — uploaded once')
          : reject(
              f,
              'NAME_CLASH',
              'Two different files share this name — rename one and add it again',
            ),
      );
      continue;
    }
    byName.set(key, f);
    accepted.push({ file: f, kind: verdict });
  }
  return { accepted, rejected };
}

/** Frames = distinct stems among photos (IMG_1.CR3 + IMG_1.JPG = one frame) — the server's rule. */
export function detectFrames(
  accepted: ReadonlyArray<{ readonly file: CandidateFile; readonly kind: UploadFileKind }>,
): number {
  return countFrames(accepted.map((a) => ({ name: a.file.name, kind: a.kind })));
}

/** Groups rejections by reason for one line each in the UI. */
export function summariseRejections(rejected: readonly Rejection[]): Array<{
  readonly reason: RejectionReason;
  readonly message: string;
  readonly names: readonly string[];
}> {
  const groups = new Map<RejectionReason, { message: string; names: string[] }>();
  for (const r of rejected) {
    const g = groups.get(r.reason) ?? { message: r.message, names: [] };
    groups.set(r.reason, { message: g.message, names: [...g.names, r.path] });
  }
  return [...groups.entries()].map(([reason, g]) => ({
    reason,
    message: g.message,
    names: g.names,
  }));
}
