import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock } from '../../../common/clock';
import { isSafeRelativePath, logicalPath } from '../folder-layout';
import {
  ChecksumMismatchError,
  MissingPartsError,
  PartChecksumMismatchError,
  PartSizeMismatchError,
  StorageInvalidInputError,
  StorageNotFoundError,
  StorageSessionNotFoundError,
} from '../storage.errors';
import type {
  ByteSource,
  CreateUploadSessionInput,
  DeliveryLink,
  PartExpectation,
  PartReceipt,
  PutObjectInput,
  ReadLink,
  StorageKind,
  StoragePort,
  StorageUsage,
  StoredObject,
  UploadSessionHandle,
} from '../storage.port';
import type { UploadBudget } from '../upload-budget';
import { TooManyBytesError, writeHashed } from './hashing-writer';

/**
 * Development/test storage on the local disk (ADR-0014 D1). Never allowed in staging/production
 * (config/env.ts). Layout under `root`:
 *   sessions/{id}/meta.json, part-NNNNN, part-NNNNN.sha256   (staging, removed on complete/abort)
 *   objects/{id} + objects/{id}.json                          (bytes + StoredObject metadata)
 *   index/{bookingId}/{id}                                    (listObjects)
 *   links/{id}.json                                           (delivery links)
 * Every commit is temp file + rename, so a reader never sees half a file.
 */

export interface LocalDiskOptions {
  readonly root: string;
  readonly limitBytes: number;
  readonly dailyLimitBytes: number | null;
}

interface SessionMeta {
  readonly input: CreateUploadSessionInput;
  readonly partCount: number;
  readonly createdAt: string;
  readonly expiresAt: string;
}

interface ObjectMeta {
  readonly objectId: string;
  readonly bookingId: string;
  readonly path: string;
  readonly kind: StorageKind;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly md5: string;
  readonly sha256: string | null;
  readonly createdAt: string;
}

interface LinkMeta {
  readonly linkId: string;
  readonly bookingId: string;
  readonly kind: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

const SESSION_TTL_MS = 7 * 24 * 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

const toStored = (m: ObjectMeta): StoredObject => ({ ...m, createdAt: new Date(m.createdAt) });

const partName = (n: number): string => `part-${String(n).padStart(5, '0')}`;

/** The parts in order, one open file at a time (never a stream per part up front). */
async function* concatFiles(paths: readonly string[]): AsyncGenerator<Uint8Array> {
  for (const path of paths) yield* createReadStream(path);
}

export class LocalDiskAdapter implements StoragePort {
  readonly adapterId = 'LOCAL_DISK' as const;

  constructor(
    private readonly options: LocalDiskOptions,
    private readonly budget: UploadBudget,
    private readonly clock: Clock,
  ) {}

  // ── paths ────────────────────────────────────────────────────────────────

  private dir(...segments: string[]): string {
    return join(this.options.root, ...segments);
  }

  /** Ids come from us, but they also arrive in paths: anything that is not a uuid never touches disk. */
  private id(value: string, what: string): string {
    if (!UUID.test(value)) throw new StorageInvalidInputError(`${what} is not a valid id`);
    return value;
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value), { flag: 'wx' });
    await rename(tmp, path);
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async session(sessionId: string): Promise<SessionMeta> {
    if (!UUID.test(sessionId)) throw new StorageSessionNotFoundError(sessionId);
    const meta = await this.readJson<SessionMeta>(this.dir('sessions', sessionId, 'meta.json'));
    if (!meta) throw new StorageSessionNotFoundError(sessionId);
    return meta;
  }

  private assertLocation(input: { relativePath: string; bookingRef: string; yearMonth: string }) {
    if (!isSafeRelativePath(input.relativePath)) {
      throw new StorageInvalidInputError('relativePath must stay inside the booking folder');
    }
    if (!/^[A-Za-z0-9-]{1,40}$/.test(input.bookingRef)) {
      throw new StorageInvalidInputError('bookingRef is not a valid folder name');
    }
    if (!/^\d{4}-\d{2}$/.test(input.yearMonth)) {
      throw new StorageInvalidInputError('yearMonth must be YYYY-MM');
    }
  }

  private partExpectedSize(meta: SessionMeta, partNumber: number): number {
    const { sizeBytes, partSizeBytes } = meta.input;
    return partNumber < meta.partCount
      ? partSizeBytes
      : sizeBytes - partSizeBytes * (meta.partCount - 1);
  }

  // ── multipart ────────────────────────────────────────────────────────────

  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSessionHandle> {
    this.id(input.bookingId, 'bookingId');
    this.assertLocation(input);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
      throw new StorageInvalidInputError('sizeBytes must be a positive integer');
    }
    if (!Number.isSafeInteger(input.partSizeBytes) || input.partSizeBytes < 1) {
      throw new StorageInvalidInputError('partSizeBytes must be a positive integer');
    }
    const sessionId = randomUUID();
    const now = this.clock();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await mkdir(this.dir('sessions', sessionId), { recursive: true });
    const meta: SessionMeta = {
      input,
      partCount: Math.max(1, Math.ceil(input.sizeBytes / input.partSizeBytes)),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
    await this.writeJson(this.dir('sessions', sessionId, 'meta.json'), meta);
    return { sessionId, uploadUrl: `local://sessions/${sessionId}`, expiresAt };
  }

  async uploadPart(
    sessionId: string,
    partNumber: number,
    body: ByteSource,
    expect: PartExpectation,
  ): Promise<PartReceipt> {
    const meta = await this.session(sessionId);
    if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > meta.partCount) {
      throw new StorageInvalidInputError(`partNumber must be 1–${meta.partCount}`);
    }
    const expected = this.partExpectedSize(meta, partNumber);
    if (expect.sizeBytes !== expected) throw new PartSizeMismatchError(expected, expect.sizeBytes);
    if (expect.sha256 === undefined && expect.md5Base64 === undefined) {
      throw new StorageInvalidInputError('a part needs a SHA-256 or an MD5 to verify against');
    }
    if (expect.sha256 !== undefined && !SHA256.test(expect.sha256)) {
      throw new StorageInvalidInputError('sha256 must be lower-case hex');
    }

    const base = this.dir('sessions', sessionId, partName(partNumber));
    const tmp = `${base}.${randomUUID()}.tmp`;
    let written: Awaited<ReturnType<typeof writeHashed>>;
    try {
      written = await writeHashed(tmp, [body], expected);
    } catch (error) {
      if (error instanceof TooManyBytesError) {
        throw new PartSizeMismatchError(expected, error.receivedAtLeast);
      }
      if (isMissing(error)) throw new StorageSessionNotFoundError(sessionId);
      throw error;
    }
    const mismatch =
      written.sizeBytes !== expected
        ? new PartSizeMismatchError(expected, written.sizeBytes)
        : (expect.sha256 !== undefined && written.sha256 !== expect.sha256) ||
            (expect.md5Base64 !== undefined && written.md5Base64 !== expect.md5Base64)
          ? new PartChecksumMismatchError()
          : null;
    if (mismatch) {
      await rm(tmp, { force: true });
      throw mismatch;
    }
    try {
      await rename(tmp, base);
      await this.writeJson(`${base}.sha256`, written.sha256);
    } catch (error) {
      await rm(tmp, { force: true });
      if (isMissing(error)) throw new StorageSessionNotFoundError(sessionId);
      throw error;
    }
    return { partNumber, sizeBytes: written.sizeBytes, sha256: written.sha256 };
  }

  async listParts(sessionId: string): Promise<PartReceipt[]> {
    const meta = await this.session(sessionId);
    const receipts: PartReceipt[] = [];
    for (let n = 1; n <= meta.partCount; n++) {
      const base = this.dir('sessions', sessionId, partName(n));
      const sha = await this.readJson<string>(`${base}.sha256`);
      if (sha === null) continue;
      try {
        const s = await stat(base);
        receipts.push({ partNumber: n, sizeBytes: s.size, sha256: sha });
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    return receipts;
  }

  async completeUpload(sessionId: string, checksum: string): Promise<StoredObject> {
    const meta = await this.session(sessionId);
    const parts = await this.listParts(sessionId);
    const have = new Map(parts.map((p) => [p.partNumber, p]));
    const missing: number[] = [];
    for (let n = 1; n <= meta.partCount; n++) {
      const p = have.get(n);
      if (!p || p.sizeBytes !== this.partExpectedSize(meta, n)) missing.push(n);
    }
    if (missing.length > 0) throw new MissingPartsError(missing);

    const objectId = randomUUID();
    const target = this.dir('objects', objectId);
    await mkdir(this.dir('objects'), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    const paths = Array.from({ length: meta.partCount }, (_, i) =>
      this.dir('sessions', sessionId, partName(i + 1)),
    );
    const written = await writeHashed(tmp, [concatFiles(paths)], meta.input.sizeBytes);
    if (written.sizeBytes !== meta.input.sizeBytes || written.sha256 !== checksum) {
      await rm(tmp, { force: true });
      await this.abortUpload(sessionId); // the parts are discarded: the file restarts from part 1
      throw new ChecksumMismatchError();
    }
    const stored = await this.commitObject(objectId, tmp, meta.input, written);
    await rm(this.dir('sessions', sessionId), { recursive: true, force: true });
    return stored;
  }

  async abortUpload(sessionId: string): Promise<void> {
    if (!UUID.test(sessionId)) return;
    await rm(this.dir('sessions', sessionId), { recursive: true, force: true });
  }

  // ── objects ──────────────────────────────────────────────────────────────

  private async commitObject(
    objectId: string,
    tmp: string,
    input: PutObjectInput | CreateUploadSessionInput,
    written: { sizeBytes: number; sha256: string; md5Hex: string },
  ): Promise<StoredObject> {
    const meta: ObjectMeta = {
      objectId,
      bookingId: input.bookingId,
      path: logicalPath(input.yearMonth, input.bookingRef, input.relativePath),
      kind: input.kind,
      contentType: input.contentType,
      sizeBytes: written.sizeBytes,
      md5: written.md5Hex,
      sha256: written.sha256,
      createdAt: this.clock().toISOString(),
    };
    await this.writeJson(this.dir('objects', `${objectId}.json`), meta);
    await rename(tmp, this.dir('objects', objectId));
    await mkdir(this.dir('index', input.bookingId), { recursive: true });
    await writeFile(this.dir('index', input.bookingId, objectId), '');
    await this.budget.record(this.adapterId, written.sizeBytes);
    return toStored(meta);
  }

  async putObject(input: PutObjectInput, body: ByteSource): Promise<StoredObject> {
    this.id(input.bookingId, 'bookingId');
    this.assertLocation(input);
    if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1) {
      throw new StorageInvalidInputError('sizeBytes must be a positive integer');
    }
    const objectId = randomUUID();
    await mkdir(this.dir('objects'), { recursive: true });
    const tmp = this.dir('objects', `${objectId}.${randomUUID()}.tmp`);
    let written: Awaited<ReturnType<typeof writeHashed>>;
    try {
      written = await writeHashed(tmp, [body], input.sizeBytes);
    } catch (error) {
      if (error instanceof TooManyBytesError) {
        throw new PartSizeMismatchError(input.sizeBytes, error.receivedAtLeast);
      }
      throw error;
    }
    if (written.sizeBytes !== input.sizeBytes) {
      await rm(tmp, { force: true });
      throw new PartSizeMismatchError(input.sizeBytes, written.sizeBytes);
    }
    return this.commitObject(objectId, tmp, input, written);
  }

  async openObject(objectId: string): Promise<ByteSource> {
    if (!UUID.test(objectId)) throw new StorageNotFoundError(`Object ${objectId}`);
    const path = this.dir('objects', objectId);
    try {
      await stat(path);
    } catch (error) {
      if (isMissing(error)) throw new StorageNotFoundError(`Object ${objectId}`);
      throw error;
    }
    return createReadStream(path);
  }

  /** Really deletes (bytes, metadata, index entry). Invariant 6 is trivially true on a disk. */
  async permanentlyDelete(objectIds: readonly string[]): Promise<void> {
    for (const objectId of objectIds) {
      if (!UUID.test(objectId)) continue;
      const meta = await this.readJson<ObjectMeta>(this.dir('objects', `${objectId}.json`));
      if (meta) await rm(this.dir('index', meta.bookingId, objectId), { force: true });
      await rm(this.dir('objects', objectId), { force: true });
      await rm(this.dir('objects', `${objectId}.json`), { force: true });
    }
  }

  async listObjects(bookingId: string): Promise<StoredObject[]> {
    this.id(bookingId, 'bookingId');
    let ids: string[];
    try {
      ids = await readdir(this.dir('index', bookingId));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const objects: StoredObject[] = [];
    for (const objectId of ids) {
      const meta = await this.readJson<ObjectMeta>(this.dir('objects', `${objectId}.json`));
      if (meta) objects.push(toStored(meta));
    }
    return objects.sort((a, b) => a.path.localeCompare(b.path));
  }

  async getUsage(): Promise<StorageUsage> {
    let used = 0;
    let names: string[] = [];
    try {
      names = await readdir(this.dir('objects'));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    for (const name of names) {
      if (!UUID.test(name)) continue;
      used += await this.sizeOf(this.dir('objects', name));
    }
    return {
      usedBytes: used + (await this.stagedBytes()),
      limitBytes: this.options.limitBytes,
      dailyUploadedBytes: await this.budget.uploadedLast24h(this.adapterId),
      dailyLimitBytes: this.options.dailyLimitBytes,
    };
  }

  /** Parts waiting in staging count as used disk (security review M5). */
  private async stagedBytes(): Promise<number> {
    let sessions: string[] = [];
    try {
      sessions = await readdir(this.dir('sessions'));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    let total = 0;
    for (const id of sessions) {
      if (!UUID.test(id)) continue;
      let parts: string[] = [];
      try {
        parts = await readdir(this.dir('sessions', id));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      for (const part of parts) {
        if (/^part-\d+$/.test(part)) total += await this.sizeOf(this.dir('sessions', id, part));
      }
    }
    return total;
  }

  private async sizeOf(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }
  }

  // ── delivery links (issued by S8; dev links are not served anywhere) ──────

  async createDeliveryLink(
    bookingId: string,
    kind: 'RAW' | 'JPEG' | 'VIDEO',
    expiresAt: Date,
  ): Promise<DeliveryLink> {
    this.id(bookingId, 'bookingId');
    const linkId = randomUUID();
    await mkdir(this.dir('links'), { recursive: true });
    const meta: LinkMeta = {
      linkId,
      bookingId,
      kind,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
    };
    await this.writeJson(this.dir('links', `${linkId}.json`), meta);
    return { linkId, url: `local://links/${linkId}` };
  }

  async revokeDeliveryLink(linkId: string): Promise<void> {
    if (!UUID.test(linkId)) throw new StorageNotFoundError(`Link ${linkId}`);
    const path = this.dir('links', `${linkId}.json`);
    const meta = await this.readJson<LinkMeta>(path);
    if (!meta) throw new StorageNotFoundError(`Link ${linkId}`);
    if (meta.revokedAt !== null) return;
    await this.writeJson(path, { ...meta, revokedAt: this.clock().toISOString() });
  }

  // ── read links (ADR-0026 D5) ─────────────────────────────────────────────

  /**
   * Local disk cannot serve a browser, so the link is a `local://` marker the panel describes
   * instead of opening (like a local delivery link). It still checks the object exists.
   */
  async createReadLink(objectId: string, expiresAt: Date): Promise<ReadLink> {
    if (!UUID.test(objectId)) throw new StorageNotFoundError(`Object ${objectId}`);
    try {
      await stat(this.dir('objects', objectId));
    } catch (error) {
      if (isMissing(error)) throw new StorageNotFoundError(`Object ${objectId}`);
      throw error;
    }
    return { url: `local://objects/${objectId}?expires=${expiresAt.getTime()}`, expiresAt };
  }

  /** Test/dev introspection: whether a link is currently revoked (not part of the port). */
  async isLinkRevoked(linkId: string): Promise<boolean> {
    const meta = await this.readJson<LinkMeta>(this.dir('links', `${linkId}.json`));
    if (!meta) throw new StorageNotFoundError(`Link ${linkId}`);
    return meta.revokedAt !== null;
  }
}
