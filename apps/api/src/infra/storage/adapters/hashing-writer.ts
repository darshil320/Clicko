import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, type WriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import type { ByteSource } from '../storage.port';

export interface WrittenFile {
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly md5Hex: string;
  readonly md5Base64: string;
}

/** Thrown from inside the copy loop as soon as more bytes arrive than allowed. */
export class TooManyBytesError extends Error {
  constructor(readonly receivedAtLeast: number) {
    super('more bytes than declared');
  }
}

async function finish(out: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    out.once('error', reject);
    out.end(() => resolve());
  });
}

/**
 * Copies `sources` (in order) into a new file at `path`, computing SHA-256 and MD5 in the same pass.
 * Stops with TooManyBytesError past `maxBytes`. On any failure the partial file is removed. Never
 * buffers more than one chunk.
 */
export async function writeHashed(
  path: string,
  sources: ReadonlyArray<ByteSource>,
  maxBytes: number,
): Promise<WrittenFile> {
  const sha = createHash('sha256');
  const md5 = createHash('md5');
  let size = 0;
  const out = createWriteStream(path, { flags: 'wx' });
  try {
    for (const source of sources) {
      for await (const chunk of source) {
        size += chunk.length;
        if (size > maxBytes) throw new TooManyBytesError(size);
        sha.update(chunk);
        md5.update(chunk);
        if (!out.write(chunk)) await once(out, 'drain');
      }
    }
    await finish(out);
  } catch (error) {
    out.destroy();
    await rm(path, { force: true });
    throw error;
  }
  const md5Digest = md5.digest();
  return {
    sizeBytes: size,
    sha256: sha.digest('hex'),
    md5Hex: md5Digest.toString('hex'),
    md5Base64: md5Digest.toString('base64'),
  };
}
