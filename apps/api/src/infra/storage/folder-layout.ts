import type { StorageKind } from './storage.port';

/**
 * The provider-agnostic folder layout (doc 02 §6, v0.2 §4):
 *   Clickco/{YYYY-MM}/{booking_ref}/{Photos-JPEG | Photos-RAW/part-NN | Video | Proof}/{file}
 * RAW sub-folders are capped at 2 GiB because Drive's server-side zip fails on large folders.
 */

export const ROOT_FOLDER = 'Clickco';
export const RAW_FOLDER_CAP_BYTES = 2 * 1024 * 1024 * 1024;

const IST_OFFSET_MS = 330 * 60_000;

/** YYYY-MM of an instant in IST (the booking folder's month). */
export function yearMonthIst(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 7);
}

export function rawPartFolder(index: number): string {
  return `Photos-RAW/part-${String(index).padStart(2, '0')}`;
}

/** The kind's folder; RAW needs its part folder from planRawFolders. */
export function folderFor(kind: Exclude<StorageKind, 'RAW'>): string {
  switch (kind) {
    case 'JPEG':
      return 'Photos-JPEG';
    case 'VIDEO':
      return 'Video';
    case 'PROOF':
      return 'Proof';
  }
}

const PART_FOLDER = /^Photos-RAW\/part-(\d+)$/;

/** The index of a `Photos-RAW/part-NN` folder, or null. */
export function rawFolderIndex(folder: string): number | null {
  const m = PART_FOLDER.exec(folder);
  return m?.[1] ? Number.parseInt(m[1], 10) : null;
}

export interface FolderFill {
  readonly folder: string;
  readonly bytes: number;
}

/**
 * Assigns RAW files to ≤ cap part folders, continuing to fill the booking's last existing folder.
 * Files keep their given order (callers pass them sorted by name). A single file larger than the cap
 * gets a folder of its own (photos are capped far below 2 GiB, so this never happens in practice).
 */
export function planRawFolders(
  existing: readonly FolderFill[],
  files: ReadonlyArray<{ readonly id: string; readonly sizeBytes: number }>,
  capBytes: number = RAW_FOLDER_CAP_BYTES,
): ReadonlyMap<string, string> {
  const fills = existing
    .map((f) => ({ index: rawFolderIndex(f.folder), bytes: f.bytes }))
    .filter((f): f is { index: number; bytes: number } => f.index !== null);
  const last = fills.reduce<{ index: number; bytes: number } | null>(
    (best, f) => (best === null || f.index > best.index ? f : best),
    null,
  );
  let index = last?.index ?? 1;
  let used = last ? fills.filter((f) => f.index === index).reduce((s, f) => s + f.bytes, 0) : 0;
  const plan = new Map<string, string>();
  for (const file of files) {
    if (used > 0 && used + file.sizeBytes > capBytes) {
      index += 1;
      used = 0;
    }
    plan.set(file.id, rawPartFolder(index));
    used += file.sizeBytes;
  }
  return plan;
}

/** `relativePath` must stay inside the booking folder: no absolute paths, no `..`, no empty segments. */
export function isSafeRelativePath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.length > 400) return false;
  if (relativePath.startsWith('/') || relativePath.includes('\\')) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(relativePath)) return false;
  return relativePath.split('/').every((s) => s.length > 0 && s !== '.' && s !== '..');
}

export function logicalPath(yearMonth: string, bookingRef: string, relativePath: string): string {
  return `${ROOT_FOLDER}/${yearMonth}/${bookingRef}/${relativePath}`;
}
