import { MEDIA_LIMITS, type UploadFileDeclaration } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { manifestMessage, validateManifest } from '../manifest';

const file = (
  name: string,
  kind: UploadFileDeclaration['kind'],
  sizeBytes = 1_000,
  clientFileId = name.replace(/[^A-Za-z0-9_-]/g, '_'),
): UploadFileDeclaration => ({ clientFileId, name, kind, sizeBytes, lastModified: 1 });

const photos = [
  file('IMG_1.CR3', 'RAW_PHOTO'),
  file('IMG_1.JPG', 'JPEG_PHOTO'),
  file('IMG_2.NEF', 'RAW_PHOTO'),
];

describe('validateManifest (ADR-0014 D2)', () => {
  it('accepts RAW + JPEG with the frame count of distinct stems', () => {
    expect(validateManifest(photos, 2, { videoEnabled: false })).toEqual({
      ok: true,
      summary: { fileCount: 3, declaredBytes: 3_000, frames: 2 },
    });
  });

  it('rejects unknown extensions, listing them', () => {
    const r = validateManifest([...photos, file('notes.txt', 'JPEG_PHOTO')], 2, {
      videoEnabled: false,
    });
    expect(r).toEqual({
      ok: false,
      problem: { code: 'UNSUPPORTED_FILE_TYPE', files: ['notes.txt'] },
    });
  });

  it('rejects a kind that does not match the extension', () => {
    const r = validateManifest([file('IMG_9.JPG', 'RAW_PHOTO')], 1, { videoEnabled: false });
    expect(r).toMatchObject({ ok: false, problem: { code: 'KIND_MISMATCH' } });
  });

  it('rejects video unless the video_uploads flag is on (OD-11)', () => {
    const withVideo = [...photos, file('C0001.MP4', 'VIDEO', 50_000_000)];
    expect(validateManifest(withVideo, 2, { videoEnabled: false })).toEqual({
      ok: false,
      problem: { code: 'VIDEO_UPLOADS_DISABLED', files: ['C0001.MP4'] },
    });
    expect(validateManifest(withVideo, 2, { videoEnabled: true }).ok).toBe(true);
  });

  it('caps photos at 200 MiB and videos at 8 GiB', () => {
    const bigPhoto = file('IMG_3.CR3', 'RAW_PHOTO', MEDIA_LIMITS.maxPhotoBytes + 1);
    expect(validateManifest([bigPhoto], 1, { videoEnabled: false })).toMatchObject({
      ok: false,
      problem: { code: 'FILE_TOO_LARGE', files: ['IMG_3.CR3'] },
    });
    const okPhoto = file('IMG_3.CR3', 'RAW_PHOTO', MEDIA_LIMITS.maxPhotoBytes);
    expect(validateManifest([okPhoto], 1, { videoEnabled: false }).ok).toBe(true);
    const video = file('C1.MOV', 'VIDEO', MEDIA_LIMITS.maxPhotoBytes * 10);
    expect(validateManifest([video], 0, { videoEnabled: true }).ok).toBe(true);
  });

  it('rejects duplicate names case-insensitively and duplicate client ids', () => {
    expect(
      validateManifest(
        [file('IMG_1.CR3', 'RAW_PHOTO', 1, 'a'), file('img_1.cr3', 'RAW_PHOTO', 1, 'b')],
        1,
        {
          videoEnabled: false,
        },
      ),
    ).toMatchObject({ ok: false, problem: { code: 'DUPLICATE_FILE_NAME' } });
    expect(
      validateManifest(
        [file('A.CR3', 'RAW_PHOTO', 1, 'same'), file('B.CR3', 'RAW_PHOTO', 1, 'same')],
        2,
        {
          videoEnabled: false,
        },
      ),
    ).toMatchObject({ ok: false, problem: { code: 'DUPLICATE_CLIENT_FILE_ID', files: ['same'] } });
  });

  it('reports a declared frame count that differs from the photos', () => {
    const r = validateManifest(photos, 3, { videoEnabled: false });
    expect(r).toEqual({
      ok: false,
      problem: { code: 'FRAME_COUNT_MISMATCH', declared: 3, detected: 2 },
    });
    if (!r.ok) expect(manifestMessage(r.problem)).toMatch(/frame count/);
  });

  it('caps a session at 200 GiB', () => {
    const many = Array.from({ length: 1_100 }, (_, i) =>
      file(`IMG_${i}.CR3`, 'RAW_PHOTO', MEDIA_LIMITS.maxPhotoBytes, `f${i}`),
    );
    expect(validateManifest(many, 1_100, { videoEnabled: false })).toMatchObject({
      ok: false,
      problem: { code: 'SESSION_TOO_LARGE' },
    });
  });
});
