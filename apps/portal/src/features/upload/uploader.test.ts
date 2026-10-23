import { createHash, randomBytes } from 'node:crypto';
import type { UploadFileState, UploadSessionView } from '@clickco/contracts';
import { describe, expect, it } from 'vitest';
import { type Checkpoint, MemoryCheckpointStore } from './checkpoints';
import { AbortedError } from './plan';
import { Sha256 } from './sha256';
import {
  type SourceFile,
  Uploader,
  type UploaderDeps,
  UploadHttpError,
  type UploadProgress,
  type UploadTransport,
} from './uploader';

const PART = 8;
const SESSION = '00000000-0000-4000-8000-0000000000aa';
const BOOKING = '00000000-0000-4000-8000-0000000000bb';
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function source(
  name: string,
  bytes: Uint8Array,
  lastModified = 1,
): SourceFile & { reads: number[] } {
  const reads: number[] = [];
  return {
    name,
    size: bytes.length,
    lastModified,
    reads,
    read: async (start, end) => {
      reads.push(start);
      return bytes.slice(start, end);
    },
  };
}

function fileState(
  id: string,
  name: string,
  bytes: Uint8Array,
  over: Partial<UploadFileState> = {},
): UploadFileState {
  return {
    clientFileId: id,
    name,
    kind: name.endsWith('.CR3') ? 'RAW_PHOTO' : 'JPEG_PHOTO',
    sizeBytes: bytes.length,
    lastModified: 1,
    partCount: Math.max(1, Math.ceil(bytes.length / PART)),
    status: 'PENDING',
    receivedParts: [],
    sha256: null,
    assetId: null,
    ...over,
  };
}

function session(files: UploadFileState[]): UploadSessionView {
  return {
    sessionId: SESSION,
    bookingId: BOOKING,
    status: 'OPEN',
    partSizeBytes: PART,
    declaredFrameCount: files.length,
    declaredFileCount: files.length,
    declaredBytes: files.reduce((s, f) => s + f.sizeBytes, 0),
    receivedFileCount: 0,
    receivedBytes: 0,
    startedAt: '2026-11-10T06:30:00.000Z',
    lastActivityAt: '2026-11-10T06:30:00.000Z',
    completedAt: null,
    failureReason: null,
    files,
  };
}

const checkpoint = (files: UploadFileState[]): Checkpoint => ({
  sessionId: SESSION,
  bookingId: BOOKING,
  photographerId: 'p1',
  createdAt: 0,
  updatedAt: 0,
  files: files.map((f) => ({
    clientFileId: f.clientFileId,
    name: f.name,
    size: f.sizeBytes,
    lastModified: 1,
    kind: f.kind,
  })),
  doneParts: {},
  verifiedFiles: [],
});

/** An in-memory API that behaves like the real one: verifies part hashes and whole-file hashes. */
class FakeServer implements UploadTransport {
  readonly parts = new Map<string, Map<number, Uint8Array>>();
  readonly puts: string[] = [];
  readonly completes: string[] = [];
  sessionCompletes = 0;
  inFlight = 0;
  maxInFlight = 0;
  /** Fail the next N part PUTs with this status. */
  failNext: { count: number; status: number } = { count: 0, status: 503 };
  /** Report the next N file completes as a checksum mismatch. */
  corruptNext = 0;
  /** Abort-aware delay per PUT so concurrency is observable. */
  delay = () => new Promise<void>((r) => setTimeout(r, 2));

  async putPart(
    _s: string,
    fileId: string,
    n: number,
    bytes: Uint8Array,
    partSha: string,
    signal: AbortSignal,
  ) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await this.delay();
      if (signal.aborted) throw new AbortedError();
      this.puts.push(`${fileId}:${n}`);
      if (this.failNext.count > 0) {
        this.failNext = { ...this.failNext, count: this.failNext.count - 1 };
        throw new UploadHttpError(this.failNext.status, 'UNAVAILABLE', 'try later');
      }
      if (sha(bytes) !== partSha)
        throw new UploadHttpError(422, 'PART_CHECKSUM_MISMATCH', 'bad part');
      const map = this.parts.get(fileId) ?? new Map<number, Uint8Array>();
      map.set(n, bytes);
      this.parts.set(fileId, map);
      return { partNumber: n, sizeBytes: bytes.length, sha256: partSha, alreadyStored: false };
    } finally {
      this.inFlight -= 1;
    }
  }

  async completeFile(_s: string, fileId: string, fileSha: string) {
    this.completes.push(fileId);
    const map = this.parts.get(fileId) ?? new Map();
    const joined = Buffer.concat(
      [...map.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => Buffer.from(b)),
    );
    if (this.corruptNext > 0 || sha(joined) !== fileSha) {
      this.corruptNext = Math.max(0, this.corruptNext - 1);
      this.parts.delete(fileId);
      throw new UploadHttpError(422, 'CHECKSUM_MISMATCH', 'mismatch');
    }
    return {
      clientFileId: fileId,
      status: 'VERIFIED' as const,
      assetId: '00000000-0000-4000-8000-000000000001',
      sizeBytes: joined.length,
      sha256: fileSha,
      receivedFileCount: 1,
      declaredFileCount: 1,
    };
  }

  async completeSession() {
    this.sessionCompletes += 1;
    return {
      sessionId: SESSION,
      bookingId: BOOKING,
      status: 'COMPLETED' as const,
      bookingStatus: 'PROCESSING' as const,
      receivedFileCount: 0,
      receivedBytes: 0,
    };
  }
}

function harness(server = new FakeServer()) {
  const slept: number[] = [];
  const store = new MemoryCheckpointStore();
  let clock = 0;
  let key = 0;
  const deps: UploaderDeps = {
    transport: server,
    checkpoints: store,
    digestPart: async (b) => sha(b),
    createHasher: () => new Sha256(),
    sleep: async (ms, signal) => {
      slept.push(ms);
      if (signal?.aborted) throw new AbortedError();
    },
    now: () => (clock += 250),
    newKey: () => `key-${++key}`,
  };
  return { server, slept, store, deps };
}

const RAW = randomBytes(30); // 4 parts: 8, 8, 8, 6
const J1 = randomBytes(5);
const J2 = randomBytes(17); // 3 parts

describe('Uploader', () => {
  it('uploads every file in ≤ 4-part concurrency, verifies the streaming hash and finishes the session', async () => {
    const { server, store, deps } = harness();
    const files = [
      fileState('raw', 'IMG_1.CR3', RAW),
      fileState('j1', 'IMG_1.JPG', J1),
      fileState('j2', 'IMG_2.JPG', J2),
    ];
    const cp = checkpoint(files);
    await store.save(cp);
    const seen: UploadProgress[] = [];
    const final = await new Uploader(deps).run(
      {
        session: session(files),
        files: new Map([
          ['raw', source('IMG_1.CR3', RAW)],
          ['j1', source('IMG_1.JPG', J1)],
          ['j2', source('IMG_2.JPG', J2)],
        ]),
        checkpoint: cp,
      },
      (p) => seen.push(p),
    );
    expect(final.phase).toBe('done');
    expect(final.result?.bookingStatus).toBe('PROCESSING');
    expect(final).toMatchObject({ bytesDone: 52, bytesAll: 52, filesDone: 3, filesAll: 3 });
    expect(server.puts).toHaveLength(8);
    expect(server.maxInFlight).toBeLessThanOrEqual(4);
    expect(server.maxInFlight).toBeGreaterThan(1);
    expect(server.completes.sort()).toEqual(['j1', 'j2', 'raw']);
    expect(server.sessionCompletes).toBe(1);
    // honest progress: never goes backwards without a restart
    const done = seen.map((p) => p.bytesDone);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(await store.load(SESSION)).toBeNull();
  });

  it('resumes: verified files and parts the server holds are not re-sent (but are re-hashed locally)', async () => {
    const { server, deps } = harness();
    const rawParts = [RAW.subarray(0, 8), RAW.subarray(8, 16)];
    server.parts.set('raw', new Map(rawParts.map((b, i) => [i + 1, new Uint8Array(b)])));
    const files = [
      fileState('raw', 'IMG_1.CR3', RAW, {
        receivedParts: rawParts.map((b, i) => ({ partNumber: i + 1, sha256: sha(b) })),
      }),
      fileState('j1', 'IMG_1.JPG', J1, {
        status: 'VERIFIED',
        sha256: sha(J1),
        assetId: '00000000-0000-4000-8000-000000000009',
      }),
      fileState('j2', 'IMG_2.JPG', J2),
    ];
    const rawSource = source('IMG_1.CR3', RAW);
    const seen: UploadProgress[] = [];
    const final = await new Uploader(deps).run(
      {
        session: session(files),
        files: new Map([
          ['raw', rawSource],
          ['j2', source('IMG_2.JPG', J2)],
        ]),
        checkpoint: checkpoint(files),
      },
      (p) => seen.push(p),
    );
    expect(final.phase).toBe('done');
    expect(seen[0]).toMatchObject({ bytesDone: 5, filesDone: 1 }); // the verified JPEG counts from the start
    expect(server.puts.filter((p) => p.startsWith('raw'))).toEqual(['raw:3', 'raw:4']);
    expect(rawSource.reads).toEqual([0, 8, 16, 24]); // all parts read for the whole-file hash
    expect(server.completes).not.toContain('j1');
  });

  it('re-sends a stored part whose hash differs from the local one', async () => {
    const { server, deps } = harness();
    const files = [
      fileState('j2', 'IMG_2.JPG', J2, {
        receivedParts: [{ partNumber: 1, sha256: 'f'.repeat(64) }],
      }),
    ];
    await new Uploader(deps).run(
      {
        session: session(files),
        files: new Map([['j2', source('IMG_2.JPG', J2)]]),
        checkpoint: checkpoint(files),
      },
      () => {},
    );
    expect(server.puts.sort()).toEqual(['j2:1', 'j2:2', 'j2:3']);
  });

  it('backs off 1, 2 s on a flaky server and succeeds', async () => {
    const { server, slept, deps } = harness();
    server.failNext = { count: 2, status: 503 };
    const files = [fileState('j1', 'IMG_1.JPG', J1)];
    const final = await new Uploader(deps).run(
      {
        session: session(files),
        files: new Map([['j1', source('IMG_1.JPG', J1)]]),
        checkpoint: checkpoint(files),
      },
      () => {},
    );
    expect(final.phase).toBe('done');
    expect(slept).toEqual([1_000, 2_000]);
  });

  it('surfaces the error after 1, 2, 4, 8, 16 s and keeps the checkpoint for a resume', async () => {
    const { server, slept, store, deps } = harness();
    server.failNext = { count: 100, status: 503 };
    const files = [fileState('j1', 'IMG_1.JPG', J1)];
    const cp = checkpoint(files);
    await store.save(cp);
    const final = await new Uploader(deps).run(
      {
        session: session(files),
        files: new Map([['j1', source('IMG_1.JPG', J1)]]),
        checkpoint: cp,
      },
      () => {},
    );
    expect(final.phase).toBe('failed');
    expect(final.error?.code).toBe('UNAVAILABLE');
    expect(slept).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(await store.load(SESSION)).not.toBeNull();
    expect(server.sessionCompletes).toBe(0);
  });

  it('re-uploads a file once after a whole-file checksum mismatch, then gives up', async () => {
    const once = harness();
    once.server.corruptNext = 1;
    const files = [fileState('j2', 'IMG_2.JPG', J2)];
    const ok = await new Uploader(once.deps).run(
      {
        session: session(files),
        files: new Map([['j2', source('IMG_2.JPG', J2)]]),
        checkpoint: checkpoint(files),
      },
      () => {},
    );
    expect(ok.phase).toBe('done');
    expect(once.server.puts).toHaveLength(6);
    expect(ok.bytesDone).toBe(J2.length);

    const twice = harness();
    twice.server.corruptNext = 2;
    const failed = await new Uploader(twice.deps).run(
      {
        session: session(files),
        files: new Map([['j2', source('IMG_2.JPG', J2)]]),
        checkpoint: checkpoint(files),
      },
      () => {},
    );
    expect(failed.phase).toBe('failed');
    expect(failed.error?.message).toMatch(/failed verification twice/);
  });

  it('pauses on request and records finished parts in the checkpoint', async () => {
    const { server, store, deps } = harness();
    const big = randomBytes(8 * 40);
    const files = [fileState('big', 'IMG_9.CR3', big)];
    const cp = checkpoint(files);
    await store.save(cp);
    const uploader = new Uploader(deps);
    let paused = false;
    const final = await uploader.run(
      {
        session: session(files),
        files: new Map([['big', source('IMG_9.CR3', big)]]),
        checkpoint: cp,
      },
      (p) => {
        if (!paused && p.bytesDone >= 8 * 5) {
          paused = true;
          uploader.pause();
        }
      },
    );
    expect(final.phase).toBe('paused');
    expect(server.puts.length).toBeLessThan(40);
    const saved = await store.load(SESSION);
    expect((saved?.doneParts.big ?? []).length).toBeGreaterThanOrEqual(5);
    expect(server.sessionCompletes).toBe(0);
  });

  it('stops with a clear message when a manifest file was not selected again', async () => {
    const { deps } = harness();
    const files = [fileState('j1', 'IMG_1.JPG', J1)];
    const final = await new Uploader(deps).run(
      { session: session(files), files: new Map(), checkpoint: checkpoint(files) },
      () => {},
    );
    expect(final).toMatchObject({ phase: 'failed', error: { code: 'FILE_NOT_SELECTED' } });
  });
});
