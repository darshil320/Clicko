import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { JobRegistry } from './infra/queues/job-registry';
import { JOB } from './infra/queues/queue-names';
import { checkedOutBooking, fakeFile, SIGNATURES } from './modules/media/__tests__/media-fixtures';
import { insertUser } from './test-support/booking-fixtures';
import { payWhatIsDue, type UploadFile, uploadAll } from './test-support/delivery-fixtures';
import { drainOutbox } from './test-support/dispatch-fixtures';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { setNow, tokenFor } from './test-support/onsite-fixtures';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FILES: UploadFile[] = [
  {
    clientFileId: 'raw',
    name: 'IMG_0001.CR3',
    kind: 'RAW_PHOTO',
    bytes: fakeFile(64_000, 11, SIGNATURES.CR3),
  },
  {
    clientFileId: 'jpg',
    name: 'IMG_0001.JPG',
    kind: 'JPEG_PHOTO',
    bytes: fakeFile(32_000, 12, SIGNATURES.JPEG),
  },
];

/** Shared steps for a booking that has checked out: upload, export, ready for QA. */
async function toQa(e2e: E2eApp, proToken: string, bookingId: string): Promise<void> {
  await uploadAll(e2e, proToken, bookingId, FILES, 1);
  await drainOutbox(e2e);
  await e2e.scheduler.runDue(e2e.get(JobRegistry), e2e.now(), JOB.MEDIA_JPEG_EXPORT);
  await drainOutbox(e2e);
}

const status = async (e2e: E2eApp, bookingId: string) =>
  (await e2e.db.sql<{ status: string }[]>`SELECT status FROM bookings WHERE id = ${bookingId}`)[0]
    ?.status;

const sla = async (e2e: E2eApp, bookingId: string) => {
  const res = await e2e.call('GET', `/dev/bookings/${bookingId}/sla`);
  const byKind = Object.fromEntries(res.json.data.clocks.map((c: Json) => [c.kind, c]));
  return { byKind, breaches: res.json.data.breaches as Json[] };
};

const qa = (e2e: E2eApp, bookingId: string, result: 'PASS' | 'FAIL', note?: string) =>
  e2e.call('POST', `/dev/deliveries/${bookingId}/qa`, {
    body: { result, ...(note ? { note } : {}) },
  });

describe.runIf(TEST_DATABASE_URL)(
  'delivery end to end: QA → balance → links → purge → closed',
  () => {
    const NOW = new Date('2026-12-01T06:30:00.000Z');
    let e2e: E2eApp;
    let proToken: string;
    let bookingId: string;
    let userId: string;
    let t0: Date;
    let clientToken: string;
    let links: Json[];

    beforeAll(async () => {
      e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
      await insertPhotographer(e2e.db.sql, {
        phone: '+919999179001',
        km: 3,
        categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
      });
      proToken = await e2e.proLogin('+919999179001');
      const walked = await checkedOutBooking(e2e, {
        clientPhone: '+919999279001',
        proToken,
        declaredFrames: 1,
      });
      ({ bookingId, userId } = walked);
      t0 = e2e.now();
      clientToken = await tokenFor(e2e, 'USER', userId);
    }, 120_000);

    afterAll(async () => {
      await e2e?.close();
    });

    it('check-out arms the six production clocks from T0', async () => {
      const { byKind } = await sla(e2e, bookingId);
      expect(Object.keys(byKind).sort()).toEqual([
        'DELIVERY_DUE',
        'DELIVERY_RED_ALERT',
        'PROCESSING_COMPLETE',
        'QA_COMPLETE',
        'UPLOAD_COMPLETE',
        'UPLOAD_START',
      ]);
      expect(byKind.DELIVERY_DUE.dueAt).toBe(new Date(t0.getTime() + 48 * HOUR).toISOString());
      expect(byKind.DELIVERY_RED_ALERT.dueAt).toBe(
        new Date(t0.getTime() + 44 * HOUR).toISOString(),
      );
    });

    it('upload and export meet the internal milestones', async () => {
      await toQa(e2e, proToken, bookingId);
      expect(await status(e2e, bookingId)).toBe('QA');
      const { byKind } = await sla(e2e, bookingId);
      for (const k of ['UPLOAD_START', 'UPLOAD_COMPLETE', 'PROCESSING_COMPLETE']) {
        expect(byKind[k].state, k).toBe('MET');
      }
      expect(byKind.QA_COMPLETE.state).toBe('ARMED');
    });

    it('the client sees what is due, and no links, before QA', async () => {
      const res = await e2e.call('GET', `/bookings/${bookingId}/delivery`, { token: clientToken });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ bookingStatus: 'QA', qaStatus: null, links: [] });
      expect(res.json.data.balanceDuePaise).toBeGreaterThan(0);
      const stranger = await tokenFor(e2e, 'USER', await insertUser(e2e.db.sql, '+919999279002'));
      const theirs = await e2e.call('GET', `/bookings/${bookingId}/delivery`, { token: stranger });
      expect(theirs.status).toBe(404);
    });

    it('a QA fail is recorded and alerted; the booking stays in QA', async () => {
      const res = await qa(e2e, bookingId, 'FAIL', 'Two frames corrupt — photographer re-sending');
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ qaStatus: 'FAILED', bookingStatus: 'QA' });
      await drainOutbox(e2e);
      const alerts = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE aggregate_id = ${bookingId} AND event_type = 'ops.alert'`;
      expect(alerts.map((a) => a.payload.source_event_type)).toContain('delivery.qa_failed');
    });

    it('a QA pass moves to BALANCE_PENDING: delivery clocks pause, reminders arm, nothing is released', async () => {
      const res = await qa(e2e, bookingId, 'PASS');
      expect(res.json.data).toMatchObject({
        qaStatus: 'PASSED',
        bookingStatus: 'BALANCE_PENDING',
        counts: { raw: { files: 1 }, jpeg: { files: 2 } },
        links: [],
      });
      await drainOutbox(e2e);
      expect(await status(e2e, bookingId)).toBe('BALANCE_PENDING');
      const { byKind } = await sla(e2e, bookingId);
      expect(byKind.QA_COMPLETE.state).toBe('MET');
      expect(byKind.DELIVERY_DUE).toMatchObject({ state: 'ARMED', paused: true });
      expect(byKind.BALANCE_REMINDER.state).toBe('ARMED');
      expect(byKind.BOOKING_ABANDON.state).toBe('ARMED');
    });

    it('waiting on the client past the due time is not a breach; the first reminder goes out', async () => {
      setNow(e2e, new Date(t0.getTime() + 49 * HOUR));
      await e2e.runDueJobs();
      await drainOutbox(e2e);
      const { byKind, breaches } = await sla(e2e, bookingId);
      expect(byKind.DELIVERY_DUE).toMatchObject({ state: 'ARMED', paused: true });
      expect(breaches).toEqual([]);
      const reminders = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE aggregate_id = ${bookingId}
        AND event_type = 'booking.balance_reminder' ORDER BY id`;
      expect(reminders.map((r) => r.payload.sequence)).toEqual([1]);
    });

    it('paying the balance issues the remainder invoice and releases the links (DELIVERED)', async () => {
      const paid = await payWhatIsDue(e2e, userId, bookingId);
      expect(paid.outcome).toBe('APPLIED');
      await drainOutbox(e2e);
      expect(await status(e2e, bookingId)).toBe('DELIVERED');
      clientToken = await tokenFor(e2e, 'USER', userId); // two days later: a fresh session
      const view = await e2e.call('GET', `/bookings/${bookingId}/delivery`, { token: clientToken });
      expect(view.json.data).toMatchObject({ bookingStatus: 'DELIVERED', balanceDuePaise: 0 });
      links = view.json.data.links;
      expect(links.map((l) => l.kind).sort()).toEqual(['JPEG_PHOTO', 'RAW_PHOTO']);
      expect(JSON.stringify(view.json)).not.toContain('local://');

      const invoices = await e2e.db.sql<{ purpose: string; total: string }[]>`
      SELECT purpose, total_amount_paise AS total FROM invoices WHERE booking_id = ${bookingId}
      ORDER BY issued_at, invoice_number`;
      expect(invoices.map((i) => i.purpose)).toEqual(['ADVANCE', 'BALANCE']);
      const [totals] = await e2e.db.sql<{ snapshots: string; invoiced: string }[]>`
      SELECT (SELECT sum(total_amount_paise) FROM booking_price_snapshots WHERE booking_id = ${bookingId})::text AS snapshots,
             (SELECT sum(total_amount_paise) FROM invoices WHERE booking_id = ${bookingId})::text AS invoiced`;
      expect(totals?.invoiced).toBe(totals?.snapshots);
      const [imbalance] = await e2e.db.sql<{ n: string }[]>`
      SELECT coalesce(sum(CASE WHEN direction = 'DEBIT' THEN amount_paise ELSE -amount_paise END), 0)::text AS n
      FROM ledger_entries WHERE booking_id = ${bookingId}`;
      expect(imbalance?.n).toBe('0');
    });

    it('the promise is met (its pause added); retention clocks run from delivery', async () => {
      const { byKind, breaches } = await sla(e2e, bookingId);
      expect(byKind.DELIVERY_DUE).toMatchObject({ state: 'MET', paused: false });
      expect(new Date(byKind.DELIVERY_DUE.effectiveDueAt).getTime()).toBeGreaterThan(
        new Date(byKind.DELIVERY_DUE.dueAt).getTime(),
      );
      expect(byKind.BALANCE_REMINDER.state).toBe('MET');
      expect(breaches).toEqual([]);
      const deliveredAt = e2e.now().getTime();
      expect(byKind.RAW_PURGE.dueAt).toBe(new Date(deliveredAt + 7 * DAY).toISOString());
      expect(byKind.JPEG_PURGE.dueAt).toBe(new Date(deliveredAt + 30 * DAY).toISOString());
    });

    it('a link opens through Clickco (counted), never exposing the provider link', async () => {
      const raw = links.find((l) => l.kind === 'RAW_PHOTO') as Json;
      // Audit M5: never a redirect to the provider — the files are listed and streamed by Clickco.
      const res = await fetch(`${e2e.baseUrl}${raw.path}`, { redirect: 'manual' });
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
      const folder = ((await res.json()) as Json).data;
      expect(folder).toMatchObject({ kind: 'RAW_PHOTO', fileCount: 1 });
      expect(folder.files).toHaveLength(1);
      expect(JSON.stringify(folder)).not.toMatch(/local:\/\/|https?:\/\//);
      const [row] = await e2e.db.sql<{ access_count: number }[]>`
      SELECT access_count FROM delivery_links WHERE booking_id = ${bookingId} AND kind = 'RAW_PHOTO'`;
      expect(row?.access_count).toBe(1);

      const file = folder.files[0] as Json;
      const download = await fetch(`${e2e.baseUrl}${file.path}`, { redirect: 'manual' });
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename=/);
      expect(download.headers.get('x-content-type-options')).toBe('nosniff');
      expect(download.headers.get('cache-control')).toBe('no-store');
      const bytes = Buffer.from(await download.arrayBuffer());
      expect(bytes.length).toBe(file.sizeBytes);
      // A file of another kind (or booking) is never served under this link.
      const [jpegAsset] = await e2e.db.sql<{ id: string }[]>`
      SELECT id FROM media_assets WHERE booking_id = ${bookingId} AND kind = 'JPEG_PHOTO' LIMIT 1`;
      const wrong = await e2e.call('GET', `${raw.path}/files/${jpegAsset?.id}`);
      expect(wrong.status).toBe(404);
      expect((await e2e.call('GET', `/d/${'A'.repeat(43)}`)).status).toBe(404);
      expect((await e2e.call('GET', '/d/short')).status).toBe(404);
    });

    it('audit L2: only the sha256 of a link token is stored', async () => {
      const rows = await e2e.db.sql<{ public_token: string | null; public_token_sha256: string }[]>`
      SELECT public_token, public_token_sha256 FROM delivery_links WHERE booking_id = ${bookingId}
      ORDER BY kind`;
      expect(rows.length).toBe(2);
      for (const link of links) {
        const token = String(link.path).slice('/d/'.length);
        const hash = createHash('sha256').update(token).digest('hex');
        expect(rows.map((r) => r.public_token_sha256)).toContain(hash);
      }
      expect(rows.every((r) => r.public_token === null)).toBe(true);
      // The owner sees the same link again later (it is derived, not stored).
      const again = await e2e.call('GET', `/bookings/${bookingId}/delivery`, {
        token: clientToken,
      });
      expect(again.json.data.links.map((l: Json) => l.path).sort()).toEqual(
        links.map((l) => l.path).sort(),
      );
    });

    it('+7 days: RAW files are purged for good and the RAW link is gone', async () => {
      setNow(e2e, new Date(e2e.now().getTime() + 7 * DAY + 60_000));
      await e2e.runDueJobs();
      await drainOutbox(e2e);
      const rows = await e2e.db.sql<{ kind: string; purged: boolean }[]>`
      SELECT kind, purged_at IS NOT NULL AS purged FROM media_assets WHERE booking_id = ${bookingId}
      ORDER BY kind`;
      expect(rows.filter((r) => r.kind === 'RAW_PHOTO').every((r) => r.purged)).toBe(true);
      expect(rows.filter((r) => r.kind === 'JPEG_PHOTO').every((r) => !r.purged)).toBe(true);
      const raw = links.find((l) => l.kind === 'RAW_PHOTO') as Json;
      expect((await e2e.call('GET', raw.path)).status).toBe(410);
      const jpeg = links.find((l) => l.kind === 'JPEG_PHOTO') as Json;
      expect((await e2e.call('GET', jpeg.path)).status).toBe(200);
    });

    it('+30 days: JPEGs purged, every link revoked, the booking CLOSED', async () => {
      setNow(e2e, new Date(t0.getTime() + 49 * HOUR + 30 * DAY + 60_000));
      await e2e.runDueJobs();
      await drainOutbox(e2e);
      expect(await status(e2e, bookingId)).toBe('CLOSED');
      const live = await e2e.db.sql`
      SELECT 1 FROM media_assets WHERE booking_id = ${bookingId} AND purged_at IS NULL`;
      expect(live).toHaveLength(0);
      const open = await e2e.db.sql`
      SELECT 1 FROM delivery_links WHERE booking_id = ${bookingId} AND revoked_at IS NULL`;
      expect(open).toHaveLength(0);
    });
  },
);

describe.runIf(TEST_DATABASE_URL)('SLA breach and zero-balance delivery', () => {
  const NOW = new Date('2026-12-05T06:30:00.000Z');
  let e2e: E2eApp;
  let proToken: string;
  let proId: string;
  const freshPro = async () => {
    proToken = await tokenFor(e2e, 'PHOTOGRAPHER', proId);
  };

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'development' });
    proId = await insertPhotographer(e2e.db.sql, {
      phone: '+919999179101',
      km: 3,
      categories: [{ code: 'PORTRAIT', tier: 'EXPERT' }],
      acceptsEmergency: true,
    });
    proToken = await e2e.proLogin('+919999179101');
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it('a late delivery: milestones missed, the promise breached, a provisional remedy for review', async () => {
    const { bookingId } = await checkedOutBooking(e2e, {
      clientPhone: '+919999279101',
      proToken,
      declaredFrames: 1,
    });
    const t0 = e2e.now();
    setNow(e2e, new Date(t0.getTime() + 49 * HOUR));
    await e2e.runDueJobs();
    await drainOutbox(e2e);
    let clocks = await sla(e2e, bookingId);
    expect(clocks.byKind.UPLOAD_COMPLETE.state).toBe('BREACHED');
    expect(clocks.byKind.DELIVERY_DUE.state).toBe('BREACHED');
    const alerts = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE aggregate_id = ${bookingId} AND event_type = 'ops.alert'`;
    expect(alerts.map((a) => a.payload.source_event_type)).toEqual(
      expect.arrayContaining(['sla.milestone_missed', 'sla.red_alert', 'sla.breached']),
    );

    setNow(e2e, new Date(t0.getTime() + 60 * HOUR));
    await freshPro();
    await toQa(e2e, proToken, bookingId);
    expect((await qa(e2e, bookingId, 'PASS')).status).toBe(200);
    await drainOutbox(e2e);
    clocks = await sla(e2e, bookingId);
    expect(clocks.breaches).toEqual([
      expect.objectContaining({
        kind: 'DELIVERY_DUE',
        delayMinutes: 12 * 60,
        band: 'H6_24',
        remedyKind: 'CREDIT',
        payoutDeductionBps: 2_500,
        attributedTo: 'PHOTOGRAPHER',
        applied: false,
      }),
    ]);
    const [review] = await e2e.db.sql<{ payload: Json }[]>`
      SELECT payload FROM domain_events WHERE aggregate_id = ${bookingId}
        AND event_type = 'booking.needs_review' AND payload->>'reason' = 'SLA_BREACH_REMEDY'`;
    expect(review?.payload).toMatchObject({ band: 'H6_24', provisional: true });
  });

  it('an emergency booking paid in full goes QA → DELIVERED at once (nothing due)', async () => {
    await freshPro();
    const { bookingId, userId } = await checkedOutBooking(e2e, {
      clientPhone: '+919999279102',
      proToken,
      declaredFrames: 1,
      startInMs: 12 * HOUR,
    });
    await toQa(e2e, proToken, bookingId);
    const res = await qa(e2e, bookingId, 'PASS');
    expect(res.json.data.balanceDuePaise).toBe(0);
    await drainOutbox(e2e);
    expect(await status(e2e, bookingId)).toBe('DELIVERED');
    const timeline = await e2e.db.sql<{ to_status: string }[]>`
      SELECT to_status FROM booking_status_events WHERE booking_id = ${bookingId}
        AND to_status IN ('BALANCE_PENDING', 'DELIVERED') ORDER BY id`;
    expect(timeline.map((t) => t.to_status)).toEqual(['BALANCE_PENDING', 'DELIVERED']);
    const balance = await e2e.db.sql`
      SELECT 1 FROM invoices WHERE booking_id = ${bookingId} AND purpose = 'BALANCE'`;
    expect(balance).toHaveLength(0);
    expect(userId).toBeDefined();
  });
});
