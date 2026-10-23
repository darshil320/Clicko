import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalDiskAdapter } from '../adapters/local-disk.adapter';
import { MemoryUploadBudget } from '../upload-budget';
import { describeStoragePortContract } from './storage-port.contract';

const clock = () => new Date();

async function adapter(dailyLimitBytes: number | null = null) {
  const root = await mkdtemp(join(tmpdir(), 'clickco-local-disk-'));
  const port = new LocalDiskAdapter(
    { root, limitBytes: 10 * 1024 * 1024, dailyLimitBytes },
    new MemoryUploadBudget(clock),
    clock,
  );
  return { root, port, close: () => rm(root, { recursive: true, force: true }) };
}

describeStoragePortContract('LocalDiskAdapter', adapter);

describe('LocalDiskAdapter specifics', () => {
  it('really deletes bytes from disk (Invariant 6: never a trash)', async () => {
    const { root, port, close } = await adapter();
    const body = Buffer.from('raw bytes');
    const stored = await port.putObject(
      {
        bookingId: randomUUID(),
        bookingRef: 'CK-DEL001',
        yearMonth: '2026-11',
        relativePath: 'Photos-RAW/part-01/a.CR3',
        fileName: 'a.CR3',
        contentType: 'image/x-canon-cr3',
        kind: 'RAW',
        sizeBytes: body.length,
      },
      [body],
    );
    expect(await readdir(join(root, 'objects'))).toContain(stored.objectId);
    await port.permanentlyDelete([stored.objectId]);
    expect(await readdir(join(root, 'objects'))).toEqual([]);
    await close();
  });

  it('reports the configured daily ceiling and the bytes it recorded', async () => {
    const { port, close } = await adapter(1_000);
    const body = Buffer.from('x'.repeat(100));
    await port.putObject(
      {
        bookingId: randomUUID(),
        bookingRef: 'CK-DAY001',
        yearMonth: '2026-11',
        relativePath: 'Photos-JPEG/a.jpg',
        fileName: 'a.jpg',
        contentType: 'image/jpeg',
        kind: 'JPEG',
        sizeBytes: body.length,
      },
      [body],
    );
    expect(await port.getUsage()).toMatchObject({
      usedBytes: 100,
      dailyUploadedBytes: 100,
      dailyLimitBytes: 1_000,
    });
    await close();
  });

  it('never touches disk for ids that are not uuids', async () => {
    const { port, close } = await adapter();
    await expect(port.listParts('../../etc')).rejects.toThrow(/does not exist/);
    await expect(port.openObject('../meta')).rejects.toThrow(/does not exist/);
    await expect(port.listObjects('../x')).rejects.toThrow(/not a valid id/);
    await close();
  });

  it('streams a multi-megabyte file through parts without corrupting it', async () => {
    const { port, close } = await adapter();
    const big = Buffer.alloc(3 * 1024 * 1024 + 17);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251;
    const partSize = 1024 * 1024;
    const s = await port.createUploadSession({
      bookingId: randomUUID(),
      bookingRef: 'CK-BIG001',
      yearMonth: '2026-11',
      relativePath: 'Photos-RAW/part-01/big.NEF',
      fileName: 'big.NEF',
      sizeBytes: big.length,
      contentType: 'image/x-nikon-nef',
      kind: 'RAW',
      partSizeBytes: partSize,
    });
    const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
    await Promise.all(
      [0, 1, 2, 3].map((i) => {
        const part = big.subarray(i * partSize, (i + 1) * partSize);
        return port.uploadPart(s.sessionId, i + 1, [part], {
          sizeBytes: part.length,
          sha256: hash(part),
        });
      }),
    );
    const stored = await port.completeUpload(s.sessionId, hash(big));
    expect(stored.sizeBytes).toBe(big.length);
    expect(stored.md5).toBe(createHash('md5').update(big).digest('hex'));
    await close();
  });
});
