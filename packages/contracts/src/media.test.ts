import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AssetKind,
  CreateUploadSessionBody,
  countFrames,
  fileExtension,
  frameStem,
  kindForFileName,
  MEDIA_LIMITS,
  partCountFor,
  UploadFileName,
  UploadSessionStatus,
} from './index.js';

const SCHEMA_SQL = readFileSync(
  fileURLToPath(new URL('../../../docs/clickco-04-schema.sql', import.meta.url)),
  'utf8',
);

function sqlEnum(name: string): string[] {
  const match = SCHEMA_SQL.match(new RegExp(`CREATE TYPE ${name} AS ENUM \\(([^;]*)\\);`));
  if (!match?.[1]) throw new Error(`enum ${name} not found in schema`);
  return [...match[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1] as string);
}

describe('media enums mirror the schema', () => {
  it.each([
    ['asset_kind', AssetKind],
    ['upload_session_status', UploadSessionStatus],
  ] as const)('%s', (sqlName, schema) => {
    expect(schema.options).toEqual(sqlEnum(sqlName));
  });
});

describe('file names', () => {
  it('maps extensions to kinds, case-insensitively', () => {
    expect(kindForFileName('IMG_0001.CR3')).toBe('RAW_PHOTO');
    expect(kindForFileName('DSC_1.nef')).toBe('RAW_PHOTO');
    expect(kindForFileName('a.DNG')).toBe('RAW_PHOTO');
    expect(kindForFileName('IMG_0001.JPG')).toBe('JPEG_PHOTO');
    expect(kindForFileName('x.jpeg')).toBe('JPEG_PHOTO');
    expect(kindForFileName('C0001.MP4')).toBe('VIDEO');
    expect(kindForFileName('notes.txt')).toBeNull();
    expect(kindForFileName('README')).toBeNull();
    expect(kindForFileName('.cr3')).toBeNull();
  });

  it('extracts extensions and stems', () => {
    expect(fileExtension('a.b.JPG')).toBe('.jpg');
    expect(fileExtension('noext')).toBe('');
    expect(frameStem('IMG_0001.CR3')).toBe('img_0001');
  });

  it('counts a RAW+JPEG pair as one frame and ignores video', () => {
    expect(
      countFrames([
        { name: 'IMG_1.CR3', kind: 'RAW_PHOTO' },
        { name: 'img_1.jpg', kind: 'JPEG_PHOTO' },
        { name: 'IMG_2.CR3', kind: 'RAW_PHOTO' },
        { name: 'C1.MP4', kind: 'VIDEO' },
      ]),
    ).toBe(2);
  });

  it('rejects path separators, control characters and hidden files', () => {
    expect(UploadFileName.safeParse('IMG_1.CR3').success).toBe(true);
    expect(UploadFileName.safeParse('../IMG_1.CR3').success).toBe(false);
    expect(UploadFileName.safeParse('a\\b.jpg').success).toBe(false);
    expect(UploadFileName.safeParse('a\u0000.jpg').success).toBe(false);
    expect(UploadFileName.safeParse('.DS_Store').success).toBe(false);
    expect(UploadFileName.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

describe('parts and limits', () => {
  it('splits into 8 MiB parts, at least one', () => {
    const p = MEDIA_LIMITS.partSizeBytes;
    expect(partCountFor(1, p)).toBe(1);
    expect(partCountFor(p, p)).toBe(1);
    expect(partCountFor(p + 1, p)).toBe(2);
    expect(partCountFor(30 * 1024 * 1024, p)).toBe(4);
  });

  it('keeps the part size inside doc 02 §7 (8–16 MB) and the backoff at 1/2/4/8/16 s', () => {
    expect(MEDIA_LIMITS.partSizeBytes).toBeGreaterThanOrEqual(8 * 1024 * 1024);
    expect(MEDIA_LIMITS.partSizeBytes).toBeLessThanOrEqual(MEDIA_LIMITS.maxPartBytes);
    expect(MEDIA_LIMITS.backoffScheduleMs).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(MEDIA_LIMITS.concurrentParts).toBe(4);
  });

  it('validates a session body', () => {
    const ok = CreateUploadSessionBody.safeParse({
      files: [
        {
          clientFileId: 'f1',
          name: 'IMG_1.CR3',
          sizeBytes: 10,
          kind: 'RAW_PHOTO',
          lastModified: 1,
        },
      ],
      declaredFrameCount: 1,
    });
    expect(ok.success).toBe(true);
    const bad = CreateUploadSessionBody.safeParse({
      files: [{ clientFileId: 'bad id', name: 'x.jpg', sizeBytes: 0, kind: 'PROOF_SHOT' }],
      declaredFrameCount: -1,
    });
    expect(bad.success).toBe(false);
  });
});
