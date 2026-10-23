import { describe, expect, it } from 'vitest';
import {
  folderFor,
  isSafeRelativePath,
  logicalPath,
  planRawFolders,
  RAW_FOLDER_CAP_BYTES,
  rawFolderIndex,
  yearMonthIst,
} from '../folder-layout';

describe('folder layout (doc 02 §6)', () => {
  it('names the month in IST', () => {
    expect(yearMonthIst(new Date('2026-11-30T19:00:00Z'))).toBe('2026-12'); // 00:30 IST on 1 Dec
    expect(yearMonthIst(new Date('2026-11-30T18:00:00Z'))).toBe('2026-11');
  });

  it('builds the provider-agnostic path', () => {
    expect(logicalPath('2026-11', 'CK-ABC123', 'Photos-JPEG/a.jpg')).toBe(
      'Clickco/2026-11/CK-ABC123/Photos-JPEG/a.jpg',
    );
    expect(folderFor('JPEG')).toBe('Photos-JPEG');
    expect(folderFor('VIDEO')).toBe('Video');
    expect(rawFolderIndex('Photos-RAW/part-07')).toBe(7);
    expect(rawFolderIndex('Photos-JPEG')).toBeNull();
  });

  it('keeps paths inside the booking folder', () => {
    expect(isSafeRelativePath('Photos-RAW/part-01/IMG.CR3')).toBe(true);
    for (const bad of ['', '/abs', '../x', 'a/../b', 'a//b', 'a\\b', 'a/./b', 'a\u0000b']) {
      expect(isSafeRelativePath(bad)).toBe(false);
    }
  });
});

describe('planRawFolders: ≤ 2 GiB part folders', () => {
  const MB = 1024 * 1024;

  it('packs files in order and opens a new folder at the cap', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, sizeBytes: 900 * MB }));
    const plan = planRawFolders([], files);
    expect([...plan.values()]).toEqual([
      'Photos-RAW/part-01',
      'Photos-RAW/part-01',
      'Photos-RAW/part-02',
      'Photos-RAW/part-02',
      'Photos-RAW/part-03',
    ]);
  });

  it('continues filling the booking’s last folder from an earlier session', () => {
    const plan = planRawFolders(
      [
        { folder: 'Photos-RAW/part-01', bytes: RAW_FOLDER_CAP_BYTES },
        { folder: 'Photos-RAW/part-02', bytes: 1900 * MB },
      ],
      [
        { id: 'a', sizeBytes: 100 * MB },
        { id: 'b', sizeBytes: 100 * MB },
      ],
    );
    expect(plan.get('a')).toBe('Photos-RAW/part-02');
    expect(plan.get('b')).toBe('Photos-RAW/part-03');
  });

  it('never leaves a folder empty for an oversize file', () => {
    const plan = planRawFolders([], [{ id: 'huge', sizeBytes: RAW_FOLDER_CAP_BYTES + 1 }]);
    expect(plan.get('huge')).toBe('Photos-RAW/part-01');
  });
});
