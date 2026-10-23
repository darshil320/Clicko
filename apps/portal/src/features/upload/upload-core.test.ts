import { createHash, randomBytes } from 'node:crypto';
import type { UploadSessionView } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { detectFrames, filterFiles, summariseRejections } from './file-filter';
import { BACKOFF_SCHEDULE_MS, isRetryableStatus, planParts, Semaphore, withRetry } from './plan';
import { etaSeconds, RateMeter } from './progress';
import { matchLocalFiles, resumePlan } from './resume';
import { Sha256, sha256Hex } from './sha256';

const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const MIB = 1024 * 1024;

describe('Sha256 (streaming, pure TS)', () => {
  it('matches Node for the padding edge sizes', () => {
    for (const size of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const data = randomBytes(size);
      expect(sha256Hex(data), `size ${size}`).toBe(nodeSha(data));
    }
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('gives the same digest however the stream is chunked', () => {
    const data = randomBytes(3 * MIB + 7);
    for (const chunk of [1, 63, 64, 65, 4096, MIB]) {
      const h = new Sha256();
      for (let i = 0; i < data.length; i += chunk) h.update(data.subarray(i, i + chunk));
      expect(h.hex(), `chunk ${chunk}`).toBe(nodeSha(data));
    }
  });

  it('refuses updates after the digest', () => {
    const h = new Sha256().update(new Uint8Array([1]));
    h.hex();
    expect(() => h.update(new Uint8Array([2]))).toThrow(/after digest/);
    expect(h.hex()).toBe(nodeSha(new Uint8Array([1])));
  });
});

describe('part planning', () => {
  it('splits into fixed parts with the remainder last', () => {
    expect(planParts(20 * MIB, 8 * MIB).map((p) => [p.partNumber, p.start, p.size])).toEqual([
      [1, 0, 8 * MIB],
      [2, 8 * MIB, 8 * MIB],
      [3, 16 * MIB, 4 * MIB],
    ]);
    expect(planParts(1, 8 * MIB)).toEqual([{ partNumber: 1, start: 0, end: 1, size: 1 }]);
    expect(planParts(16 * MIB, 8 * MIB)).toHaveLength(2);
    expect(() => planParts(0, 8)).toThrow(RangeError);
  });
});

describe('backoff (doc 02 §7: 1, 2, 4, 8, 16 s, then surface)', () => {
  const fail = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
  const retryOn = (e: unknown) => isRetryableStatus((e as { status: number }).status);

  it('uses exactly the doc schedule', () => {
    expect(BACKOFF_SCHEDULE_MS).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it('retries 5xx / 429 / network and succeeds when the server recovers', async () => {
    const slept: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw fail(calls === 1 ? 503 : 429);
        return 'ok';
      },
      { isRetryable: retryOn, sleep: async (ms) => void slept.push(ms) },
    );
    expect(result).toBe('ok');
    expect(slept).toEqual([1_000, 2_000]);
  });

  it('surfaces the error after the last delay', async () => {
    const slept: number[] = [];
    await expect(
      withRetry(async () => Promise.reject(fail(0)), {
        isRetryable: retryOn,
        sleep: async (ms) => void slept.push(ms),
      }),
    ).rejects.toThrow('HTTP 0');
    expect(slept).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it('never retries a 4xx the client must fix', async () => {
    const slept: number[] = [];
    await expect(
      withRetry(async () => Promise.reject(fail(422)), {
        isRetryable: retryOn,
        sleep: async (ms) => void slept.push(ms),
      }),
    ).rejects.toThrow('HTTP 422');
    expect(slept).toEqual([]);
    expect([0, 408, 429, 500, 503].every(isRetryableStatus)).toBe(true);
    expect([400, 401, 404, 409, 422].some(isRetryableStatus)).toBe(false);
  });

  it('limits concurrency with a FIFO semaphore', async () => {
    const sem = new Semaphore(2);
    const a = await sem.acquire();
    await sem.acquire();
    let third = false;
    const pending = sem.acquire().then(() => {
      third = true;
    });
    await Promise.resolve();
    expect(third).toBe(false);
    a();
    await pending;
    expect(third).toBe(true);
    expect(sem.inFlight).toBe(2);
  });
});

describe('folder drop filter', () => {
  const f = (name: string, size = 10, lastModified = 1, path?: string) => ({
    name,
    size,
    lastModified,
    path,
  });

  it('keeps RAW and JPEG, rejects everything else with a reason', () => {
    const { accepted, rejected } = filterFiles(
      [
        f('IMG_0001.CR3'),
        f('IMG_0001.JPG'),
        f('DSC_0002.nef'),
        f('._IMG_0001.CR3'),
        f('.DS_Store'),
        f('INDEX.BIN'),
        f('C0001.MP4'),
        f('EMPTY.ARW', 0),
        f('HUGE.DNG', 201 * MIB),
      ],
      { videoEnabled: false },
    );
    expect(accepted.map((a) => [a.file.name, a.kind])).toEqual([
      ['IMG_0001.CR3', 'RAW_PHOTO'],
      ['IMG_0001.JPG', 'JPEG_PHOTO'],
      ['DSC_0002.nef', 'RAW_PHOTO'],
    ]);
    expect(Object.fromEntries(rejected.map((r) => [r.name, r.reason]))).toEqual({
      '._IMG_0001.CR3': 'HIDDEN',
      '.DS_Store': 'HIDDEN',
      'INDEX.BIN': 'UNSUPPORTED_TYPE',
      'C0001.MP4': 'VIDEO_DISABLED',
      'EMPTY.ARW': 'EMPTY',
      'HUGE.DNG': 'TOO_LARGE',
    });
    expect(detectFrames(accepted)).toBe(2);
  });

  it('accepts video only when the flag is on', () => {
    expect(filterFiles([f('C0001.MP4', 500 * MIB)], { videoEnabled: true }).accepted).toHaveLength(
      1,
    );
  });

  it('keeps one copy of a dual-card duplicate and refuses two different files with one name', () => {
    const { accepted, rejected } = filterFiles(
      [
        f('IMG_1.CR3', 10, 5, 'A/IMG_1.CR3'),
        f('IMG_1.CR3', 10, 5, 'B/IMG_1.CR3'),
        f('img_1.cr3', 99, 7, 'C/img_1.cr3'),
      ],
      { videoEnabled: false },
    );
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => [r.path, r.reason])).toEqual([
      ['B/IMG_1.CR3', 'DUPLICATE'],
      ['C/img_1.cr3', 'NAME_CLASH'],
    ]);
    expect(summariseRejections(rejected).map((g) => g.reason)).toEqual(['DUPLICATE', 'NAME_CLASH']);
  });
});

describe('resume diffing', () => {
  const session: Pick<UploadSessionView, 'files' | 'partSizeBytes'> = {
    partSizeBytes: 8,
    files: [
      {
        clientFileId: 'a',
        name: 'A.CR3',
        kind: 'RAW_PHOTO',
        sizeBytes: 20,
        lastModified: 1,
        partCount: 3,
        status: 'PENDING',
        receivedParts: [
          { partNumber: 1, sha256: '1'.repeat(64) },
          { partNumber: 3, sha256: '3'.repeat(64) },
        ],
        sha256: null,
        assetId: null,
      },
      {
        clientFileId: 'b',
        name: 'B.JPG',
        kind: 'JPEG_PHOTO',
        sizeBytes: 5,
        lastModified: 2,
        partCount: 1,
        status: 'VERIFIED',
        receivedParts: [],
        sha256: 'b'.repeat(64),
        assetId: '00000000-0000-4000-8000-000000000001',
      },
      {
        clientFileId: 'c',
        name: 'C.JPG',
        kind: 'JPEG_PHOTO',
        sizeBytes: 7,
        lastModified: 3,
        partCount: 1,
        status: 'PENDING',
        receivedParts: [],
        sha256: null,
        assetId: null,
      },
    ],
  };

  it('counts verified files and parts already stored', () => {
    const plan = resumePlan(session);
    expect(plan).toMatchObject({ verifiedFiles: 1, verifiedBytes: 5, storedPartBytes: 8 + 4 });
    expect([...(plan.files[0]?.stored ?? new Map()).keys()]).toEqual([1, 3]);
    expect(plan.files[1]?.verified).toBe(true);
  });

  it('matches re-dropped files by name, size and timestamp; lists what is missing', () => {
    const local = [
      { name: 'A.CR3', size: 20, lastModified: 1 },
      { name: 'C.JPG', size: 7, lastModified: 999 }, // edited since: not the same file
      { name: 'B.JPG', size: 5, lastModified: 2 },
    ];
    const m = matchLocalFiles(session, local);
    expect([...m.matched.keys()]).toEqual(['a']);
    expect(m.missing.map((s) => s.clientFileId)).toEqual(['c']);
  });
});

describe('honest progress', () => {
  it('measures the acknowledged rate over a sliding window', () => {
    const meter = new RateMeter(30_000);
    meter.record(0, 0);
    expect(meter.bytesPerSecond(500)).toBeNull();
    meter.record(2_000, 8 * MIB);
    expect(meter.bytesPerSecond(2_000)).toBe(4 * MIB);
    meter.record(4_000, 8 * MIB);
    expect(meter.bytesPerSecond(4_000)).toBe(4 * MIB);
    expect(meter.bytesPerSecond(60_000)).toBeNull(); // nothing in the last 30 s
    expect(etaSeconds(40 * MIB, 4 * MIB)).toBe(10);
    expect(etaSeconds(0, null)).toBe(0);
    expect(etaSeconds(1, null)).toBeNull();
  });
});
