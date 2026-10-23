import { fileExtension, type UploadFileKind } from '@clickco/contracts';
import { HttpException } from '@nestjs/common';
import { StorageError, StorageNotConfiguredError } from '../../infra/storage/storage.errors';
import type { StorageKind } from '../../infra/storage/storage.port';
import { storageUnavailable, unavailable } from './http-errors';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.cr2': 'image/x-canon-cr2',
  '.cr3': 'image/x-canon-cr3',
  '.nef': 'image/x-nikon-nef',
  '.arw': 'image/x-sony-arw',
  '.raf': 'image/x-fuji-raf',
  '.orf': 'image/x-olympus-orf',
  '.rw2': 'image/x-panasonic-rw2',
  '.dng': 'image/x-adobe-dng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.mts': 'video/mp2t',
};

export const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[fileExtension(name)] ?? 'application/octet-stream';

export function storageKindOf(kind: UploadFileKind): StorageKind {
  switch (kind) {
    case 'RAW_PHOTO':
      return 'RAW';
    case 'JPEG_PHOTO':
      return 'JPEG';
    case 'VIDEO':
      return 'VIDEO';
  }
}

/**
 * A storage failure the media routes did not map explicitly: not configured ⇒ 503; anything else
 * ⇒ 503 STORAGE_UNAVAILABLE (logged by the caller) — never the provider's message.
 */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HttpException) return error;
  if (error instanceof StorageNotConfiguredError) return storageUnavailable();
  if (error instanceof StorageError) {
    return unavailable('STORAGE_UNAVAILABLE', 'Storage is not answering — retry shortly');
  }
  return error;
}

/** Runs `fn` over `items` with at most `limit` in flight; rejects on the first failure. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}
