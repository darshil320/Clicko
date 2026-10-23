import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChecksumMismatchError,
  MissingPartsError,
  PartChecksumMismatchError,
  PartSizeMismatchError,
  StorageInvalidInputError,
  StorageNotFoundError,
  StorageSessionNotFoundError,
} from '../storage.errors';
import type { ByteSource, CreateUploadSessionInput, StoragePort } from '../storage.port';

/**
 * The StoragePort contract (ADR-0014 D1). LocalDiskAdapter passes it today; GoogleDriveAdapter must
 * pass it before it can be switched on (PLAN B10), and so must any future R2 adapter.
 */

export interface ContractHarness {
  readonly port: StoragePort;
  close(): Promise<void>;
}

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const md5Hex = (b: Buffer): string => createHash('md5').update(b).digest('hex');
const md5Base64 = (b: Buffer): string => createHash('md5').update(b).digest('base64');

/** A source that yields `b` in small chunks, like a socket would. */
async function* chunked(b: Buffer, size = 3): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < b.length; i += size) yield b.subarray(i, i + size);
}

const collect = async (source: ByteSource): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const c of source) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};

export function describeStoragePortContract(
  name: string,
  makeHarness: () => Promise<ContractHarness>,
): void {
  describe(`StoragePort contract: ${name}`, () => {
    let h: ContractHarness;
    const bookingId = randomUUID();
    const PART = 8;
    const content = Buffer.from('0123456789abcdefghijKLMNOPQRS'); // 29 bytes → 4 parts of 8,8,8,5
    const parts = [0, 1, 2, 3].map((i) => content.subarray(i * PART, (i + 1) * PART));

    const input = (over: Partial<CreateUploadSessionInput> = {}): CreateUploadSessionInput => ({
      bookingId,
      bookingRef: 'CK-TEST01',
      yearMonth: '2026-11',
      relativePath: 'Photos-RAW/part-01/IMG_0001.CR3',
      fileName: 'IMG_0001.CR3',
      sizeBytes: content.length,
      contentType: 'image/x-canon-cr3',
      kind: 'RAW',
      partSizeBytes: PART,
      ...over,
    });

    const put = (sessionId: string, n: number, body = parts[n - 1] as Buffer) =>
      h.port.uploadPart(sessionId, n, chunked(body), {
        sizeBytes: body.length,
        sha256: sha256(body),
      });

    beforeAll(async () => {
      h = await makeHarness();
    });
    afterAll(async () => {
      await h?.close();
    });

    it('opens a session with an internal upload URL and a future expiry', async () => {
      const s = await h.port.createUploadSession(input());
      expect(s.sessionId).toEqual(expect.any(String));
      expect(s.uploadUrl.length).toBeGreaterThan(0);
      expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
      await h.port.abortUpload(s.sessionId);
    });

    it('assembles parts sent out of order and verifies the whole-file SHA-256', async () => {
      // Measured before staging: staged parts may already count as used (local disk does, M5).
      const before = await h.port.getUsage();
      const s = await h.port.createUploadSession(input());
      for (const n of [3, 1, 4, 2]) await put(s.sessionId, n);
      const listed = await h.port.listParts(s.sessionId);
      expect(listed.map((p) => p.partNumber)).toEqual([1, 2, 3, 4]);
      expect(listed[3]).toEqual({
        partNumber: 4,
        sizeBytes: 5,
        sha256: sha256(parts[3] as Buffer),
      });

      const stored = await h.port.completeUpload(s.sessionId, sha256(content));
      expect(stored).toMatchObject({
        bookingId,
        kind: 'RAW',
        sizeBytes: content.length,
        md5: md5Hex(content),
        sha256: sha256(content),
        path: 'Clickco/2026-11/CK-TEST01/Photos-RAW/part-01/IMG_0001.CR3',
      });
      expect(await collect(await h.port.openObject(stored.objectId))).toEqual(content);
      const objects = await h.port.listObjects(bookingId);
      expect(objects.map((o) => o.objectId)).toContain(stored.objectId);

      const after = await h.port.getUsage();
      expect(after.usedBytes - before.usedBytes).toBe(content.length);
      expect(after.dailyUploadedBytes - before.dailyUploadedBytes).toBe(content.length);
      // the session is consumed
      await expect(put(s.sessionId, 1)).rejects.toBeInstanceOf(StorageSessionNotFoundError);
    });

    it('rejects a part whose size or hash is wrong, and keeps nothing', async () => {
      const s = await h.port.createUploadSession(input());
      const p1 = parts[0] as Buffer;
      await expect(
        h.port.uploadPart(s.sessionId, 1, chunked(p1.subarray(0, 5)), {
          sizeBytes: 8,
          sha256: sha256(p1),
        }),
      ).rejects.toBeInstanceOf(PartSizeMismatchError);
      await expect(
        h.port.uploadPart(s.sessionId, 1, chunked(Buffer.concat([p1, Buffer.from('x')])), {
          sizeBytes: 8,
          sha256: sha256(p1),
        }),
      ).rejects.toBeInstanceOf(PartSizeMismatchError);
      await expect(
        h.port.uploadPart(s.sessionId, 1, chunked(Buffer.from('XXXXXXXX')), {
          sizeBytes: 8,
          sha256: sha256(p1),
        }),
      ).rejects.toBeInstanceOf(PartChecksumMismatchError);
      await expect(
        h.port.uploadPart(s.sessionId, 1, chunked(p1), {
          sizeBytes: 8,
          sha256: sha256(p1),
          md5Base64: md5Base64(Buffer.from('other')),
        }),
      ).rejects.toBeInstanceOf(PartChecksumMismatchError);
      // declared size must be the planned size for that part number
      await expect(
        h.port.uploadPart(s.sessionId, 4, chunked(p1), { sizeBytes: 8, sha256: sha256(p1) }),
      ).rejects.toBeInstanceOf(PartSizeMismatchError);
      await expect(put(s.sessionId, 5, p1)).rejects.toBeInstanceOf(StorageInvalidInputError);
      expect(await h.port.listParts(s.sessionId)).toEqual([]);
      await h.port.abortUpload(s.sessionId);
    });

    it('verifies a part by MD5 alone, and refuses a part with nothing to verify', async () => {
      const s = await h.port.createUploadSession(input());
      const p2 = parts[1] as Buffer;
      const receipt = await h.port.uploadPart(s.sessionId, 2, chunked(p2), {
        sizeBytes: 8,
        md5Base64: md5Base64(p2),
      });
      expect(receipt.sha256).toBe(sha256(p2));
      await expect(
        h.port.uploadPart(s.sessionId, 1, chunked(parts[0] as Buffer), { sizeBytes: 8 }),
      ).rejects.toBeInstanceOf(StorageInvalidInputError);
      await h.port.abortUpload(s.sessionId);
    });

    it('accepts a matching Content-MD5 and replaces a re-put part', async () => {
      const s = await h.port.createUploadSession(input());
      const p1 = parts[0] as Buffer;
      await h.port.uploadPart(s.sessionId, 1, chunked(p1), {
        sizeBytes: 8,
        sha256: sha256(p1),
        md5Base64: md5Base64(p1),
      });
      const other = Buffer.from('ZZZZZZZZ');
      await put(s.sessionId, 1, other);
      expect(await h.port.listParts(s.sessionId)).toEqual([
        { partNumber: 1, sizeBytes: 8, sha256: sha256(other) },
      ]);
      await h.port.abortUpload(s.sessionId);
    });

    it('refuses to complete with parts missing', async () => {
      const s = await h.port.createUploadSession(input());
      await put(s.sessionId, 1);
      await put(s.sessionId, 3);
      const error = await h.port.completeUpload(s.sessionId, sha256(content)).catch((e) => e);
      expect(error).toBeInstanceOf(MissingPartsError);
      expect((error as MissingPartsError).missingParts).toEqual([2, 4]);
      await h.port.abortUpload(s.sessionId);
    });

    it('discards every part when the whole-file checksum does not match', async () => {
      const s = await h.port.createUploadSession(input());
      for (const n of [1, 2, 3, 4]) await put(s.sessionId, n);
      await expect(
        h.port.completeUpload(s.sessionId, sha256(Buffer.from('nope'))),
      ).rejects.toBeInstanceOf(ChecksumMismatchError);
      await expect(h.port.listParts(s.sessionId)).rejects.toBeInstanceOf(
        StorageSessionNotFoundError,
      );
      expect((await h.port.listObjects(bookingId)).every((o) => o.path.endsWith('.CR3'))).toBe(
        true,
      );
    });

    it('aborts idempotently', async () => {
      const s = await h.port.createUploadSession(input());
      await put(s.sessionId, 1);
      await h.port.abortUpload(s.sessionId);
      await h.port.abortUpload(s.sessionId);
      await expect(put(s.sessionId, 2)).rejects.toBeInstanceOf(StorageSessionNotFoundError);
      await expect(h.port.listParts(s.sessionId)).rejects.toBeInstanceOf(
        StorageSessionNotFoundError,
      );
    });

    it('refuses a path that escapes the booking folder', async () => {
      await expect(
        h.port.createUploadSession(input({ relativePath: '../other/IMG.CR3' })),
      ).rejects.toBeInstanceOf(StorageInvalidInputError);
      await expect(
        h.port.createUploadSession(input({ relativePath: '/etc/passwd' })),
      ).rejects.toBeInstanceOf(StorageInvalidInputError);
    });

    it('puts a single-shot object and refuses a short body', async () => {
      const jpeg = Buffer.from('jpeg-bytes');
      const stored = await h.port.putObject(
        {
          bookingId,
          bookingRef: 'CK-TEST01',
          yearMonth: '2026-11',
          relativePath: 'Photos-JPEG/IMG_0001.jpg',
          fileName: 'IMG_0001.jpg',
          contentType: 'image/jpeg',
          kind: 'JPEG',
          sizeBytes: jpeg.length,
        },
        chunked(jpeg),
      );
      expect(stored).toMatchObject({ kind: 'JPEG', sizeBytes: jpeg.length, md5: md5Hex(jpeg) });
      expect(await collect(await h.port.openObject(stored.objectId))).toEqual(jpeg);
      await expect(
        h.port.putObject(
          {
            bookingId,
            bookingRef: 'CK-TEST01',
            yearMonth: '2026-11',
            relativePath: 'Photos-JPEG/short.jpg',
            fileName: 'short.jpg',
            contentType: 'image/jpeg',
            kind: 'JPEG',
            sizeBytes: 100,
          },
          chunked(jpeg),
        ),
      ).rejects.toBeInstanceOf(PartSizeMismatchError);
    });

    it('permanently deletes, ignoring unknown ids', async () => {
      const objects = await h.port.listObjects(bookingId);
      expect(objects.length).toBeGreaterThan(0);
      const ids = objects.map((o) => o.objectId);
      await h.port.permanentlyDelete([...ids, randomUUID(), 'not-an-id']);
      expect(await h.port.listObjects(bookingId)).toEqual([]);
      await expect(h.port.openObject(ids[0] as string)).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('lists nothing for an unknown booking', async () => {
      expect(await h.port.listObjects(randomUUID())).toEqual([]);
    });

    it('creates and revokes delivery links idempotently', async () => {
      const link = await h.port.createDeliveryLink(
        bookingId,
        'JPEG',
        new Date(Date.now() + 86_400_000),
      );
      expect(link.url.length).toBeGreaterThan(0);
      await h.port.revokeDeliveryLink(link.linkId);
      await h.port.revokeDeliveryLink(link.linkId);
      await expect(h.port.revokeDeliveryLink(randomUUID())).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
    });

    it('reports usage with a positive limit', async () => {
      const usage = await h.port.getUsage();
      expect(usage.limitBytes).toBeGreaterThan(0);
      expect(usage.usedBytes).toBeGreaterThanOrEqual(0);
      expect(usage.dailyUploadedBytes).toBeGreaterThanOrEqual(0);
    });
  });
}
