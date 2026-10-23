/**
 * Security review M8: a file's first bytes must match its extension before it is kept, delivered
 * or handed to darktable. A loose check by design — it tells a RAW from a renamed script or a
 * JPEG, not a valid file from a corrupt one (darktable and the QA pass do that).
 */
import { fileExtension } from '@clickco/contracts';

/** Bytes needed to decide (the longest signature is the RAF magic). */
export const SIGNATURE_PREFIX_BYTES = 16;

type Signature = (b: Buffer) => boolean;

const at = (offset: number, ...expected: ReadonlyArray<number | string>): Signature => {
  const want = Buffer.concat(
    expected.map((e) => (typeof e === 'string' ? Buffer.from(e, 'latin1') : Buffer.from([e]))),
  );
  return (b) =>
    b.length >= offset + want.length && b.subarray(offset, offset + want.length).equals(want);
};
const anyOf =
  (...signatures: readonly Signature[]): Signature =>
  (b) =>
    signatures.some((s) => s(b));

const JPEG = at(0, 0xff, 0xd8, 0xff);
const TIFF = anyOf(at(0, 'II', 0x2a, 0x00), at(0, 'MM', 0x00, 0x2a));
/** ISO base media: a box size, then `ftyp`. */
const FTYP = at(4, 'ftyp');
/** QuickTime files may open with a non-ftyp atom. */
const QUICKTIME = anyOf(
  FTYP,
  ...['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].map((a) => at(4, a)),
);
/** MPEG-TS (sync byte at 0) or BDAV M2TS (4-byte timecode, then the sync byte). */
const MPEG_TS = anyOf(at(0, 0x47), at(4, 0x47));

const SIGNATURES: Readonly<Record<string, Signature>> = {
  '.jpg': JPEG,
  '.jpeg': JPEG,
  '.cr2': (b) => TIFF(b) && at(8, 'CR')(b),
  '.cr3': at(4, 'ftypcrx '),
  '.nef': TIFF,
  '.arw': TIFF,
  '.dng': TIFF,
  '.raf': at(0, 'FUJIFILMCCD-RAW'),
  '.orf': anyOf(at(0, 'IIRO'), at(0, 'IIRS'), at(0, 'MMOR')),
  '.rw2': at(0, 'IIU', 0x00),
  '.mp4': FTYP,
  '.m4v': FTYP,
  '.mov': QUICKTIME,
  '.mts': MPEG_TS,
};

/** True when `header` (the file's first bytes) looks like the format the name claims. */
export function matchesFileSignature(name: string, header: Buffer): boolean {
  const signature = SIGNATURES[fileExtension(name)];
  return signature?.(header) ?? false;
}

/** The first `bytes` of a byte source (stops reading once it has them). */
export async function readPrefix(
  source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  bytes = SIGNATURE_PREFIX_BYTES,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of source) {
    chunks.push(Buffer.from(chunk));
    length += chunk.length;
    if (length >= bytes) break;
  }
  return Buffer.concat(chunks).subarray(0, bytes);
}
