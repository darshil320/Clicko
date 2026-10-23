import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE_PORT, type StoragePort } from '../../../infra/storage/storage.port';
import { type E2eApp, type Json, startE2eApp } from '../../../test-support/e2e-app';
import { setNow } from '../../../test-support/onsite-fixtures';
import { insertPhotographer } from '../../../test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { UploadReaperService } from '../upload-reaper.service';
import { checkedOutBooking, fakeFile, SIGNATURES, sha256 } from './media-fixtures';

const NOW = new Date('2026-11-12T06:30:00.000Z');
const MIB = 1024 * 1024;
const PART = 8 * MIB;
const RAW = fakeFile(20 * MIB, 7, SIGNATURES.CR3);

describe.runIf(TEST_DATABASE_URL)('upload reaper (security review M5: staged parts)', () => {
  let e2e: E2eApp;
  let proToken: string;
  let bookingId: string;
  let sessionId: string;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    await insertPhotographer(e2e.db.sql, {
      phone: '+919825078001',
      km: 3,
      categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
    });
    proToken = await e2e.proLogin('+919825078001');
    ({ bookingId } = await checkedOutBooking(e2e, {
      clientPhone: '+919700078001',
      proToken,
      declaredFrames: 1,
    }));
  }, 90_000);

  afterAll(async () => {
    await e2e?.close();
  });

  const view = async () =>
    (await e2e.call('GET', `/pro/upload-sessions/${sessionId}`, { token: proToken })).json.data;

  it('takes a 3,000-file manifest: past the default 100 kB body limit (security review L1)', async () => {
    const files = Array.from({ length: 3_000 }, (_, i) => ({
      clientFileId: `f${i}`,
      name: `IMG_${String(i).padStart(5, '0')}.CR3`,
      sizeBytes: 30_000_000,
      kind: 'RAW_PHOTO',
      lastModified: 1_700_000_000_000,
    }));
    const body = { files, declaredFrameCount: 3_000 };
    expect(JSON.stringify(body).length).toBeGreaterThan(300_000);
    // Someone else's booking id: the body is parsed and the request reaches the service (404).
    const res = await e2e.call(
      'POST',
      '/pro/bookings/00000000-0000-4000-8000-000000000000/upload-sessions',
      {
        token: proToken,
        idempotencyKey: `big-${Date.now()}`,
        body,
      },
    );
    expect(res.status).toBe(404);
  });

  it('staged parts count as used storage', async () => {
    const storage = e2e.get<StoragePort>(STORAGE_PORT);
    const before = (await storage.getUsage()).usedBytes;
    const opened = await e2e.call('POST', `/pro/bookings/${bookingId}/upload-sessions`, {
      token: proToken,
      idempotencyKey: `reaper-${Date.now()}`,
      body: {
        files: [
          {
            clientFileId: 'raw',
            name: 'IMG_7.CR3',
            sizeBytes: RAW.length,
            kind: 'RAW_PHOTO',
            lastModified: 1,
          },
        ],
        declaredFrameCount: 1,
      },
    });
    expect(opened.status, JSON.stringify(opened.json)).toBe(201);
    sessionId = opened.json.data.sessionId;
    const part = RAW.subarray(0, PART);
    const put = await e2e.call('PUT', `/pro/upload-sessions/${sessionId}/files/raw/parts/1`, {
      token: proToken,
      rawBody: part,
      headers: { 'content-type': 'application/octet-stream', 'x-part-sha256': sha256(part) },
    });
    expect(put.status).toBe(200);
    expect((await storage.getUsage()).usedBytes - before).toBe(PART);
  });

  it('leaves a session alone for 24 h, then drops its staged parts and tells ops', async () => {
    const reaper = e2e.get(UploadReaperService);
    setNow(e2e, new Date(NOW.getTime() + 23 * 3_600_000));
    expect(await reaper.sweep()).toEqual({ sessions: 0, files: 0 });

    setNow(e2e, new Date(NOW.getTime() + 25 * 3_600_000));
    expect(await reaper.sweep()).toEqual({ sessions: 1, files: 1 });
    proToken = await e2e.proLogin('+919825078001'); // a day later: a fresh session
    const data = await view();
    expect(data.status).toBe('UPLOADING');
    expect(data.files[0]).toMatchObject({ status: 'PENDING', receivedParts: [] });
    const [alert] = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE event_type = 'ops.alert' AND aggregate_id = ${bookingId}
        AND payload->>'source_event_type' = 'media.upload_session_idle'`;
    expect(alert?.payload.details).toMatchObject({
      upload_session_id: sessionId,
      files_restarted: 1,
    });
    // Restarting counts as activity: the next run has nothing to do.
    expect(await reaper.sweep()).toEqual({ sessions: 0, files: 0 });
  });

  it('the photographer can still finish the file from the first part', async () => {
    for (let n = 1; n <= 3; n++) {
      const part = RAW.subarray((n - 1) * PART, n * PART);
      const put = await e2e.call('PUT', `/pro/upload-sessions/${sessionId}/files/raw/parts/${n}`, {
        token: proToken,
        rawBody: part,
        headers: { 'content-type': 'application/octet-stream', 'x-part-sha256': sha256(part) },
      });
      expect(put.status).toBe(200);
    }
    const done = await e2e.call('POST', `/pro/upload-sessions/${sessionId}/files/raw/complete`, {
      token: proToken,
      idempotencyKey: `reaper-done-${Date.now()}`,
      body: { sha256: sha256(RAW) },
    });
    expect(done.status, JSON.stringify(done.json)).toBe(200);
  });
});
