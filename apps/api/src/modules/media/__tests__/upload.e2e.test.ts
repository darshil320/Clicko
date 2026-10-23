import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRegistry } from '../../../infra/queues/job-registry';
import { JOB } from '../../../infra/queues/queue-names';
import { StorageNotFoundError } from '../../../infra/storage/storage.errors';
import { STORAGE_PORT, type StoragePort } from '../../../infra/storage/storage.port';
import { drainOutbox, eventsOf } from '../../../test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from '../../../test-support/e2e-app';
import { insertPhotographer } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { IntegrityAuditService } from '../integrity-audit.service';
import { QuotaMonitorService } from '../quota-monitor.service';
import { checkedOutBooking, fakeBytes, md5, sha256 } from './media-fixtures';

const NOW = new Date('2026-11-10T06:30:00.000Z');
const MIB = 1024 * 1024;
const PART = 8 * MIB;
const PRO = '+919825077001';
const OTHER_PRO = '+919825077002';
const CLIENT = '+919700077001';

const RAW = fakeBytes(20 * MIB, 1); // 3 parts: 8 + 8 + 4 MiB
const JPEG_1 = fakeBytes(150_000, 2);
const JPEG_2 = fakeBytes(90_000, 3);
const STRAY = fakeBytes(40_000, 4);

const manifest = [
  {
    clientFileId: 'raw-1',
    name: 'IMG_0001.CR3',
    sizeBytes: RAW.length,
    kind: 'RAW_PHOTO',
    lastModified: 1_700_000_000_000,
  },
  {
    clientFileId: 'jpg-1',
    name: 'IMG_0001.JPG',
    sizeBytes: JPEG_1.length,
    kind: 'JPEG_PHOTO',
    lastModified: 1_700_000_000_000,
  },
  {
    clientFileId: 'jpg-2',
    name: 'IMG_0002.JPG',
    sizeBytes: JPEG_2.length,
    kind: 'JPEG_PHOTO',
    lastModified: 1_700_000_000_000,
  },
];

describe.runIf(TEST_DATABASE_URL)(
  'media upload end to end: CHECKED_OUT → UPLOADING → PROCESSING → QA',
  () => {
    let e2e: E2eApp;
    let proToken: string;
    let otherToken: string;
    let bookingId: string;
    let assignmentId: string;
    let checkedOutAt: Date;
    let sessionId: string;
    let key = 0;
    const idem = () => `media-e2e-${++key}-${Date.now()}`;

    const createSession = (body: Json, token = proToken, idempotencyKey = idem()) =>
      e2e.call('POST', `/pro/bookings/${bookingId}/upload-sessions`, {
        token,
        idempotencyKey,
        body,
      });

    const putPart = (
      sid: string,
      fileId: string,
      n: number,
      bytes: Buffer,
      headers: Record<string, string> = { 'x-part-sha256': sha256(bytes) },
      token = proToken,
    ) =>
      e2e.call('PUT', `/pro/upload-sessions/${sid}/files/${fileId}/parts/${n}`, {
        token,
        rawBody: bytes,
        headers: { 'content-type': 'application/octet-stream', ...headers },
      });

    const completeFile = (sid: string, fileId: string, bytes: Buffer, idempotencyKey = idem()) =>
      e2e.call('POST', `/pro/upload-sessions/${sid}/files/${fileId}/complete`, {
        token: proToken,
        idempotencyKey,
        body: { sha256: sha256(bytes) },
      });

    const uploadWhole = async (sid: string, fileId: string, bytes: Buffer) => {
      for (let n = 1; n * PART < bytes.length + PART; n++) {
        const part = bytes.subarray((n - 1) * PART, n * PART);
        const r = await putPart(sid, fileId, n, part);
        expect(r.status, JSON.stringify(r.json)).toBe(200);
      }
      return completeFile(sid, fileId, bytes);
    };

    const status = async () =>
      (
        await e2e.db.sql<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${bookingId}`
      )[0]?.status;

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
      await insertPhotographer(e2e.db.sql, {
        phone: PRO,
        name: 'Kavya Rao',
        km: 3,
        categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
      });
      await insertPhotographer(e2e.db.sql, { phone: OTHER_PRO, name: 'Other Pro', city: 'Mumbai' });
      proToken = await e2e.proLogin(PRO);
      otherToken = await e2e.proLogin(OTHER_PRO);
      const walked = await checkedOutBooking(e2e, {
        clientPhone: CLIENT,
        proToken,
        declaredFrames: 2,
      });
      bookingId = walked.bookingId;
      assignmentId = walked.assignmentId;
      checkedOutAt = walked.checkedOutAt;
    }, 90_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('lists the checked-out shoot with a 6-hour deadline from check-out', async () => {
      expect(await status()).toBe('CHECKED_OUT');
      const jobs = await e2e.call('GET', '/pro/upload-jobs', { token: proToken });
      expect(jobs.status).toBe(200);
      expect(jobs.json.data).toHaveLength(1);
      expect(jobs.json.data[0]).toMatchObject({
        bookingId,
        assignmentId,
        bookingStatus: 'CHECKED_OUT',
        checkedOutAt: checkedOutAt.toISOString(),
        uploadDeadlineAt: new Date(checkedOutAt.getTime() + 6 * 3_600_000).toISOString(),
        activeSession: null,
      });
      const other = await e2e.call('GET', '/pro/upload-jobs', { token: otherToken });
      expect(other.json.data).toEqual([]);
    });

    it('refuses another photographer, a missing key, and bad manifests', async () => {
      const theirs = await createSession({ files: manifest, declaredFrameCount: 2 }, otherToken);
      expect(theirs.status).toBe(404);
      expect(theirs.json.error.code).toBe('BOOKING_NOT_FOUND');

      const noKey = await e2e.call('POST', `/pro/bookings/${bookingId}/upload-sessions`, {
        token: proToken,
        body: { files: manifest, declaredFrameCount: 2 },
      });
      expect(noKey.json.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const cases: Array<[Json, string]> = [
        [
          {
            files: [{ ...manifest[1], name: 'notes.txt', clientFileId: 't' }],
            declaredFrameCount: 1,
          },
          'UNSUPPORTED_FILE_TYPE',
        ],
        [
          { files: [{ ...manifest[1], kind: 'RAW_PHOTO' }], declaredFrameCount: 1 },
          'KIND_MISMATCH',
        ],
        [
          { files: [{ ...manifest[0], sizeBytes: 200 * MIB + 1 }], declaredFrameCount: 1 },
          'FILE_TOO_LARGE',
        ],
        [{ files: manifest, declaredFrameCount: 3 }, 'FRAME_COUNT_MISMATCH'],
        [
          {
            files: [
              ...manifest,
              {
                clientFileId: 'v1',
                name: 'C0001.MP4',
                sizeBytes: 10 * MIB,
                kind: 'VIDEO',
                lastModified: 1,
              },
            ],
            declaredFrameCount: 2,
          },
          'VIDEO_UPLOADS_DISABLED',
        ],
      ];
      for (const [body, code] of cases) {
        const r = await createSession(body);
        expect(r.status, code).toBe(422);
        expect(r.json.error.code).toBe(code);
      }
      // The flag enabled for another city does not open video here (ADR-0014 D2).
      await e2e.db.sql`
      INSERT INTO feature_flags (key, is_enabled, enabled_cities)
      SELECT 'video_uploads', true, ARRAY[id] FROM cities WHERE name = 'Mumbai'`;
      const stillOff = await createSession(cases[4]?.[0] as Json);
      expect(stillOff.json.error.code).toBe('VIDEO_UPLOADS_DISABLED');
      await e2e.db.sql`DELETE FROM feature_flags WHERE key = 'video_uploads'`;
      expect(await status()).toBe('CHECKED_OUT');
    });

    it('the first session moves CHECKED_OUT → UPLOADING; aborting deletes its files for good', async () => {
      const opened = await createSession({
        files: [
          {
            clientFileId: 'stray',
            name: 'IMG_0099.JPG',
            sizeBytes: STRAY.length,
            kind: 'JPEG_PHOTO',
            lastModified: 1,
          },
        ],
        declaredFrameCount: 1,
      });
      expect(opened.status, JSON.stringify(opened.json)).toBe(201);
      expect(opened.json.data).toMatchObject({
        status: 'OPEN',
        partSizeBytes: PART,
        declaredFileCount: 1,
      });
      expect(await status()).toBe('UPLOADING');
      const strayId = opened.json.data.sessionId as string;

      const again = await createSession({ files: manifest, declaredFrameCount: 2 });
      expect(again.status).toBe(409);
      expect(again.json.error).toMatchObject({
        code: 'UPLOAD_SESSION_ACTIVE',
        details: { sessionId: strayId },
      });

      const done = await uploadWhole(strayId, 'stray', STRAY);
      expect(done.status).toBe(200);
      const [asset] = await e2e.db.sql<{ storage_object_id: string }[]>`
      SELECT storage_object_id FROM media_assets WHERE upload_session_id = ${strayId}`;
      const storage = e2e.get<StoragePort>(STORAGE_PORT);
      await expect(storage.openObject(asset?.storage_object_id as string)).resolves.toBeDefined();

      const aborted = await e2e.call('POST', `/pro/upload-sessions/${strayId}/abort`, {
        token: proToken,
        idempotencyKey: idem(),
      });
      expect(aborted.json.data).toEqual({ sessionId: strayId, status: 'ABORTED' });
      await expect(storage.openObject(asset?.storage_object_id as string)).rejects.toBeInstanceOf(
        StorageNotFoundError,
      );
      const [row] = await e2e.db.sql<{ purged_at: Date | null }[]>`
      SELECT purged_at FROM media_assets WHERE upload_session_id = ${strayId}`;
      expect(row?.purged_at).not.toBeNull();
      expect(await status()).toBe('UPLOADING');
    });

    it('opens the real session and hides it from other photographers', async () => {
      const opened = await createSession({ files: manifest, declaredFrameCount: 2 });
      expect(opened.status).toBe(201);
      sessionId = opened.json.data.sessionId;
      const raw = opened.json.data.files.find((f: Json) => f.clientFileId === 'raw-1');
      expect(raw).toMatchObject({ partCount: 3, status: 'PENDING', receivedParts: [] });
      const theirs = await e2e.call('GET', `/pro/upload-sessions/${sessionId}`, {
        token: otherToken,
      });
      expect(theirs.status).toBe(404);
      const theirPart = await putPart(
        sessionId,
        'raw-1',
        1,
        RAW.subarray(0, PART),
        undefined,
        otherToken,
      );
      expect(theirPart.status).toBe(404);
    });

    it('verifies every part: size, checksum, range; a repeated part is a no-op', async () => {
      const p1 = RAW.subarray(0, PART);
      const wrongHash = await putPart(sessionId, 'raw-1', 1, p1, {
        'x-part-sha256': sha256(Buffer.from('x')),
      });
      expect(wrongHash.status).toBe(422);
      expect(wrongHash.json.error.code).toBe('PART_CHECKSUM_MISMATCH');
      const short = await putPart(sessionId, 'raw-1', 1, p1.subarray(0, 100));
      expect(short.json.error.code).toBe('PART_SIZE_MISMATCH');
      const outOfRange = await putPart(sessionId, 'raw-1', 4, p1);
      expect(outOfRange.json.error.code).toBe('PART_OUT_OF_RANGE');
      const unsigned = await putPart(sessionId, 'raw-1', 1, p1, {});
      expect(unsigned.json.error.code).toBe('PART_CHECKSUM_REQUIRED');
      const badMd5 = await putPart(sessionId, 'raw-1', 1, p1, {
        'content-md5': 'AAAAAAAAAAAAAAAAAAAAAA==',
      });
      expect(badMd5.json.error.code).toBe('PART_CHECKSUM_MISMATCH');

      for (const n of [3, 1, 2]) {
        const r = await putPart(sessionId, 'raw-1', n, RAW.subarray((n - 1) * PART, n * PART));
        expect(r.status).toBe(200);
        expect(r.json.data.alreadyStored).toBe(false);
      }
      const repeat = await putPart(sessionId, 'raw-1', 2, RAW.subarray(PART, 2 * PART));
      expect(repeat.json.data).toMatchObject({ partNumber: 2, alreadyStored: true });

      const view = await e2e.call('GET', `/pro/upload-sessions/${sessionId}`, { token: proToken });
      const raw = view.json.data.files.find((f: Json) => f.clientFileId === 'raw-1');
      expect(raw.receivedParts.map((p: Json) => p.partNumber)).toEqual([1, 2, 3]);
      expect(view.json.data.status).toBe('UPLOADING');
    });

    it('a whole-file checksum mismatch discards the parts and restarts the file', async () => {
      const bad = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/files/raw-1/complete`, {
        token: proToken,
        idempotencyKey: idem(),
        body: { sha256: sha256(Buffer.from('not the file')) },
      });
      expect(bad.status).toBe(422);
      expect(bad.json.error.code).toBe('CHECKSUM_MISMATCH');
      const view = await e2e.call('GET', `/pro/upload-sessions/${sessionId}`, { token: proToken });
      const raw = view.json.data.files.find((f: Json) => f.clientFileId === 'raw-1');
      expect(raw).toMatchObject({ status: 'PENDING', receivedParts: [] });

      // The browser sends 4 parts at a time: concurrent jsonb updates must not lose a part.
      const parallel = await Promise.all(
        [1, 2, 3].map((n) =>
          putPart(sessionId, 'raw-1', n, RAW.subarray((n - 1) * PART, n * PART)),
        ),
      );
      expect(parallel.map((r) => r.status)).toEqual([200, 200, 200]);
      const resumed = await e2e.call('GET', `/pro/upload-sessions/${sessionId}`, {
        token: proToken,
      });
      const rawState = resumed.json.data.files.find((f: Json) => f.clientFileId === 'raw-1');
      expect(rawState.receivedParts.map((p: Json) => p.partNumber)).toEqual([1, 2, 3]);
      const good = await completeFile(sessionId, 'raw-1', RAW);
      expect(good.status).toBe(200);
      expect(good.json.data).toMatchObject({
        clientFileId: 'raw-1',
        status: 'VERIFIED',
        sizeBytes: RAW.length,
      });
      const replay = await completeFile(sessionId, 'raw-1', RAW);
      expect(replay.json.data.assetId).toBe(good.json.data.assetId);
      const afterVerify = await putPart(sessionId, 'raw-1', 1, RAW.subarray(0, PART));
      expect(afterVerify.json.error.code).toBe('FILE_ALREADY_VERIFIED');
    });

    it('reconciles declared vs received before the job counts as uploaded', async () => {
      const early = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/complete`, {
        token: proToken,
        idempotencyKey: idem(),
      });
      expect(early.status).toBe(409);
      expect(early.json.error).toMatchObject({
        code: 'UPLOAD_INCOMPLETE',
        details: { missingCount: 2 },
      });

      expect((await uploadWhole(sessionId, 'jpg-1', JPEG_1)).status).toBe(200);
      expect((await uploadWhole(sessionId, 'jpg-2', JPEG_2)).status).toBe(200);

      const completeKey = idem();
      const done = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/complete`, {
        token: proToken,
        idempotencyKey: completeKey,
      });
      expect(done.status, JSON.stringify(done.json)).toBe(200);
      expect(done.json.data).toEqual({
        sessionId,
        bookingId,
        status: 'COMPLETED',
        bookingStatus: 'PROCESSING',
        receivedFileCount: 3,
        receivedBytes: RAW.length + JPEG_1.length + JPEG_2.length,
      });
      const replay = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/complete`, {
        token: proToken,
        idempotencyKey: completeKey,
      });
      expect(replay.headers.get('idempotent-replayed')).toBe('true');
      expect(await status()).toBe('PROCESSING');

      const assets = await e2e.db.sql<
        { original_filename: string; checksum_md5: string; purge_after: Date | null }[]
      >`
      SELECT original_filename, checksum_md5, purge_after FROM media_assets
      WHERE upload_session_id = ${sessionId} ORDER BY original_filename`;
      expect(assets.map((a) => [a.original_filename, a.checksum_md5])).toEqual([
        ['IMG_0001.CR3', md5(RAW)],
        ['IMG_0001.JPG', md5(JPEG_1)],
        ['IMG_0002.JPG', md5(JPEG_2)],
      ]);
      // Invariant 7: retention is measured from delivered_at — nothing is scheduled for purge yet.
      expect(assets.every((a) => a.purge_after === null)).toBe(true);

      const lateSession = await createSession({ files: manifest, declaredFrameCount: 2 });
      expect(lateSession.json.error.code).toBe('BOOKING_NOT_UPLOADABLE');
    });

    it('exports RAW → JPEG through the passthrough and moves PROCESSING → QA', async () => {
      await drainOutbox(e2e);
      const pending = e2e.scheduler.pending(JOB.MEDIA_JPEG_EXPORT);
      expect(pending.map((j) => j.jobId)).toEqual([`jpeg-export-${bookingId}`]);
      await e2e.scheduler.runDue(e2e.get(JobRegistry), e2e.now(), JOB.MEDIA_JPEG_EXPORT);
      expect(await status()).toBe('QA');

      const derived = await e2e.db.sql<
        { original_filename: string; width_px: number; storage_path: string }[]
      >`
      SELECT d.original_filename, d.width_px, d.storage_path FROM media_assets d
      JOIN media_assets r ON r.id = d.derived_from_asset_id
      WHERE r.booking_id = ${bookingId}`;
      expect(derived).toHaveLength(1);
      expect(derived[0]).toMatchObject({
        original_filename: 'img_0001.export-pending.jpg',
        width_px: 1,
      });
      expect(derived[0]?.storage_path).toMatch(/^Clickco\/2026-11\/CLK-\d+\/Photos-JPEG\//);

      const events = await eventsOf(e2e, bookingId);
      expect(events).toEqual(
        expect.arrayContaining([
          'booking.checked_out',
          'booking.uploading',
          'booking.processing',
          'booking.qa',
        ]),
      );
      const jobs = await e2e.call('GET', '/pro/upload-jobs', { token: proToken });
      expect(jobs.json.data[0]).toMatchObject({
        bookingStatus: 'QA',
        activeSession: null,
        media: { rawFiles: 1, jpegFiles: 2, videoFiles: 0, exportedJpegs: 1 },
      });
    });

    it('audits declared vs stored vs provider and alerts on a missing file', async () => {
      const audit = e2e.get(IntegrityAuditService);
      expect(await audit.auditBooking(bookingId)).toBe('OK');
      const [victim] = await e2e.db.sql<{ storage_object_id: string }[]>`
      SELECT storage_object_id FROM media_assets
      WHERE booking_id = ${bookingId} AND original_filename = 'IMG_0002.JPG'`;
      await e2e
        .get<StoragePort>(STORAGE_PORT)
        .permanentlyDelete([victim?.storage_object_id as string]);
      expect(await audit.auditBooking(bookingId)).toBe('MISMATCH');
      const rows = await e2e.db.sql<{ result: string; provider_count: number; db_count: number }[]>`
      SELECT result, provider_count, db_count FROM media_integrity_audits
      WHERE booking_id = ${bookingId} ORDER BY ran_at, id`;
      // Same pinned clock for both runs: compare as a set.
      expect(rows.map((r) => r.result).sort()).toEqual(['MISMATCH', 'OK']);
      const alerts = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE event_type = 'ops.alert' AND aggregate_id = ${bookingId}`;
      expect(alerts.map((a) => a.payload.source_event_type)).toContain('media.integrity_mismatch');
    });

    it('samples storage usage for the quota monitor', async () => {
      const { sample, plan } = await e2e.get(QuotaMonitorService).sample();
      expect(sample).toMatchObject({ adapter: 'LOCAL_DISK' });
      expect(sample.usedBytes).toBeGreaterThan(0);
      expect(plan.storage).toBeNull();
      const [row] = await e2e.db.sql<
        { n: string }[]
      >`SELECT count(*) AS n FROM storage_quota_samples`;
      expect(Number(row?.n)).toBe(1);
    });
  },
);
