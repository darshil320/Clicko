import type { StaffRole } from '@clickco/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORAGE_PORT, type StoragePort } from './infra/storage/storage.port';
import { type E2eApp, type Json, startE2eApp } from './test-support/e2e-app';
import { insertPhotographer } from './test-support/photographer-fixtures';
import { TEST_DATABASE_URL } from './test-support/scratch-db';
import { bootstrapStaff, cityIdOf, staffToken } from './test-support/staff-fixtures';

const NOW = new Date('2026-12-07T04:30:00.000Z');
let keySeq = 0;
const idem = () => `admin-supply-${String(++keySeq).padStart(6, '0')}`;

/**
 * ADR-0026 D5 end to end: an applicant added, moved across the kanban (every move logged with its
 * reason), KYC documents opened through audited 5-minute links and decided (ticking the manual
 * checks), the application approved (APPLICANT → ACTIVE), the directory, a penalty waived and
 * status changes. Role and city rules throughout; identifiers only ever leave masked.
 */
describe.runIf(TEST_DATABASE_URL)('the photographers desk', () => {
  let e2e: E2eApp;
  const staff = {} as Record<
    'admin' | 'cmSurat' | 'cmMumbai' | 'ops' | 'qm' | 'support' | 'readOnly' | 'finance',
    string
  >;
  let surat: string;
  let applicationId: string;
  let photographerId: string;
  const docs = {} as Record<'pan' | 'dl' | 'police' | 'bank' | 'expired' | 'missing', string>;

  const as = (who: keyof typeof staff) => staffToken(e2e, staff[who]);
  const get = async (who: keyof typeof staff, path: string) =>
    e2e.call('GET', path, { token: await as(who) });
  const post = async (who: keyof typeof staff, path: string, body?: unknown) =>
    e2e.call('POST', path, {
      token: await as(who),
      idempotencyKey: idem(),
      ...(body === undefined ? {} : { body }),
    });
  const auditRows = (action: string) =>
    e2e.db.sql<{ actor_id: string; entity_id: string; after_state: Json }[]>`
      SELECT actor_id, entity_id, after_state FROM audit_logs WHERE action = ${action} ORDER BY id`;
  const insertDoc = async (
    kind: string,
    opts: { storageKey?: string; last4?: string; issuedOn?: string; expiresOn?: string } = {},
  ) => {
    const [row] = await e2e.db.sql<{ id: string }[]>`
      INSERT INTO photographer_documents (photographer_id, kind, storage_key, original_filename,
        mime_type, size_bytes, reference_last4, issued_on, expires_on, uploaded_at)
      VALUES (${photographerId}, ${kind}, ${opts.storageKey ?? `missing/${kind}`},
              ${'ABCDE1234F.pdf'}, 'application/pdf', 1024, ${opts.last4 ?? null},
              ${opts.issuedOn ?? null}, ${opts.expiresOn ?? null}, ${e2e.now()})
      RETURNING id`;
    e2e.advance(1_000);
    if (!row) throw new Error('insertDoc');
    return row.id;
  };

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    surat = await cityIdOf(e2e, 'Surat');
    const mumbai = await cityIdOf(e2e, 'Mumbai');
    const make = async (key: keyof typeof staff, role: StaffRole, cityId: string | null = null) => {
      staff[key] = (await bootstrapStaff(e2e, `${key}@clickco.test`, role, cityId)).id;
    };
    await make('admin', 'SUPER_ADMIN');
    await make('cmSurat', 'CITY_MANAGER', surat);
    await make('cmMumbai', 'CITY_MANAGER', mumbai);
    await make('ops', 'OPS_AGENT');
    await make('qm', 'QUALITY_MANAGER');
    await make('support', 'SUPPORT');
    await make('readOnly', 'READ_ONLY');
    await make('finance', 'FINANCE');
  }, 120_000);

  afterAll(async () => {
    await e2e?.close();
  });

  describe('onboarding kanban', () => {
    it('ops adds a walk-in applicant: an APPLICANT photographer and an APPLIED application', async () => {
      const res = await post('ops', '/admin/supply/applicants', {
        fullName: 'Asha Patel',
        phone: '+919825088001',
        cityId: surat,
        source: 'WALK_IN',
        portfolioUrl: 'https://portfolio.example/asha',
        yearsExperience: 4,
        note: 'Came to the Surat office',
      });
      expect(res.status).toBe(201);
      expect(res.json.data).toMatchObject({
        stage: 'APPLIED',
        cityName: 'Surat',
        source: 'WALK_IN',
      });
      applicationId = res.json.data.id;
      photographerId = res.json.data.photographerId;
      const [pro] = await e2e.db.sql<{ status: string }[]>`
        SELECT status FROM photographers WHERE id = ${photographerId}`;
      expect(pro?.status).toBe('APPLICANT');
    });

    it('refuses a duplicate phone, another city, a bad link and a role that cannot add', async () => {
      const body = {
        fullName: 'Asha Two',
        phone: '+919825088001',
        cityId: surat,
        source: 'REFERRAL',
      };
      expect((await post('ops', '/admin/supply/applicants', body)).json.error.code).toBe(
        'PHOTOGRAPHER_EXISTS',
      );
      const other = { ...body, phone: '+919825088002' };
      expect((await post('cmMumbai', '/admin/supply/applicants', other)).status).toBe(403);
      expect((await post('support', '/admin/supply/applicants', other)).status).toBe(403);
      const script = { ...other, portfolioUrl: 'javascript:alert(1)' };
      expect((await post('ops', '/admin/supply/applicants', script)).status).toBe(400);
    });

    it('the board shows it in its column; another city does not', async () => {
      const board = await get('ops', '/admin/supply/applications');
      expect(board.status).toBe(200);
      const columns = board.json.data.columns as Json[];
      expect(columns).toHaveLength(13);
      const applied = columns.find((c) => c.stage === 'APPLIED');
      expect(applied?.count).toBe(1);
      expect(applied?.items[0]).toMatchObject({ id: applicationId, fullName: 'Asha Patel' });
      const mumbai = await get('cmMumbai', '/admin/supply/applications');
      expect((mumbai.json.data.columns as Json[]).every((c) => c.count === 0)).toBe(true);
      const hidden = await get('readOnly', '/admin/supply/applications');
      const card = (hidden.json.data.columns as Json[]).find((c) => c.stage === 'APPLIED')
        ?.items[0];
      expect(card.phone).not.toBe('+919825088001');
      expect(card.phone).toMatch(/\*/);
      expect((await get('finance', '/admin/supply/applications')).status).toBe(403);
    });

    it('a move needs a reason, is logged as an event and audited', async () => {
      e2e.advance(60_000);
      const path = `/admin/supply/applications/${applicationId}/move`;
      expect((await post('ops', path, { toStage: 'SCREENING', note: '' })).status).toBe(400);
      const res = await post('ops', path, { toStage: 'SCREENING', note: 'Portfolio is strong' });
      expect(res.status).toBe(200);
      expect(res.json.data.stage).toBe('SCREENING');
      const detail = await get('ops', `/admin/supply/applications/${applicationId}`);
      expect(
        (detail.json.data.history as Json[]).map((h) => [h.fromStage, h.toStage, h.note]),
      ).toEqual([
        [null, 'APPLIED', 'Came to the Surat office'],
        ['APPLIED', 'SCREENING', 'Portfolio is strong'],
      ]);
      expect(detail.json.data.history[1].actorName).toBe('Test OPS_AGENT');
      const audits = await auditRows('application.move');
      expect(audits.at(-1)).toMatchObject({ actor_id: staff.ops, entity_id: applicationId });
      const stranger = await post('cmMumbai', path, { toStage: 'ON_HOLD', note: 'Not mine' });
      expect(stranger.status).toBe(404);
    });

    it('only a city manager approves, and only once the four checks are ticked', async () => {
      const path = `/admin/supply/applications/${applicationId}/move`;
      const byOps = await post('ops', path, { toStage: 'APPROVED', note: 'Looks ready' });
      expect(byOps.status).toBe(403);
      const early = await post('cmSurat', path, { toStage: 'APPROVED', note: 'Looks ready' });
      expect(early.status).toBe(422);
      expect(early.json.error.code).toBe('VERIFICATION_INCOMPLETE');
      expect(early.json.error.message).toContain('the PAN card');
    });
  });

  describe('KYC queue', () => {
    beforeAll(async () => {
      const storage = e2e.get<StoragePort>(STORAGE_PORT);
      const bytes = Buffer.from('%PDF-1.4 test pan card');
      const stored = await storage.putObject(
        {
          bookingId: photographerId,
          bookingRef: 'KYC',
          yearMonth: '2026-12',
          relativePath: 'kyc/pan.pdf',
          fileName: 'pan.pdf',
          contentType: 'application/pdf',
          kind: 'PROOF',
          sizeBytes: bytes.length,
        },
        [bytes],
      );
      docs.pan = await insertDoc('PAN_CARD', { storageKey: stored.objectId, last4: '234F' });
      docs.dl = await insertDoc('DRIVING_LICENCE', { last4: '9876', expiresOn: '2030-01-01' });
      docs.police = await insertDoc('POLICE_VERIFICATION', {
        issuedOn: '2026-11-20',
        expiresOn: '2027-11-20',
      });
      docs.bank = await insertDoc('BANK_PROOF', { last4: '4321' });
      docs.expired = await insertDoc('DRONE_RPC', { expiresOn: '2026-12-01' });
    });

    it('lists pending documents oldest first, identifiers masked, file names never shown', async () => {
      const res = await get('ops', '/admin/supply/kyc');
      expect(res.status).toBe(200);
      const items = res.json.data.items as Json[];
      expect(items.map((i) => i.id)).toEqual([
        docs.pan,
        docs.dl,
        docs.police,
        docs.bank,
        docs.expired,
      ]);
      expect(items[0]).toMatchObject({ kind: 'PAN_CARD', referenceMasked: '•••• 234F' });
      expect(JSON.stringify(res.json)).not.toContain('ABCDE1234F');
      expect((await get('cmMumbai', '/admin/supply/kyc')).json.data.items).toEqual([]);
    });

    it('opens a document only through a 5-minute link, audited per view', async () => {
      const path = `/admin/supply/kyc/${docs.pan}/view-link`;
      expect((await post('ops', path)).status).toBe(403);
      expect((await post('cmMumbai', path)).status).toBe(404);
      const res = await post('cmSurat', path);
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ opensInBrowser: false });
      expect(Date.parse(res.json.data.expiresAt) - e2e.now().getTime()).toBe(300_000);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const views = await auditRows('kyc.document_view');
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ actor_id: staff.cmSurat, entity_id: docs.pan });
      const missing = await post('cmSurat', `/admin/supply/kyc/${docs.dl}/view-link`);
      expect(missing.status).toBe(404);
      expect(missing.json.error.code).toBe('DOCUMENT_FILE_MISSING');
    });

    it('a rejection needs a reason; an expired document cannot be approved', async () => {
      const path = `/admin/supply/kyc/${docs.expired}/decide`;
      expect((await post('cmSurat', path, { decision: 'REJECT' })).status).toBe(400);
      const approve = await post('cmSurat', path, { decision: 'APPROVE' });
      expect(approve.json.error.code).toBe('DOCUMENT_EXPIRED');
      const reject = await post('cmSurat', path, { decision: 'REJECT', note: 'Expired on 1 Dec' });
      expect(reject.status).toBe(200);
      expect(reject.json.data.reviewStatus).toBe('REJECTED');
    });

    it('approving PAN, licence, police and bank proof ticks the four checks', async () => {
      expect(
        (await post('ops', `/admin/supply/kyc/${docs.pan}/decide`, { decision: 'APPROVE' })).status,
      ).toBe(403);
      let last: Json = {};
      for (const id of [docs.pan, docs.dl, docs.police, docs.bank]) {
        const res = await post('cmSurat', `/admin/supply/kyc/${id}/decide`, {
          decision: 'APPROVE',
        });
        expect(res.status).toBe(200);
        last = res.json.data;
      }
      expect(last.verification).toMatchObject({
        idProofKind: 'DRIVING_LICENCE',
        idProofMasked: '•••• 9876',
        policeVerifiedOn: '2026-11-20',
        policeVerificationExpires: '2027-11-20',
      });
      expect(last.verification.panVerifiedAt).not.toBeNull();
      expect(last.verification.bankVerifiedAt).not.toBeNull();
      const again = await post('cmSurat', `/admin/supply/kyc/${docs.pan}/decide`, {
        decision: 'APPROVE',
      });
      expect(again.json.error.code).toBe('DOCUMENT_ALREADY_REVIEWED');
      expect((await auditRows('kyc.decide')).length).toBe(5);
    });

    it('approval now onboards the photographer (APPLICANT → ACTIVE); APPROVED is final', async () => {
      const path = `/admin/supply/applications/${applicationId}/move`;
      const res = await post('cmSurat', path, { toStage: 'APPROVED', note: 'All checks done' });
      expect(res.status).toBe(200);
      expect(res.json.data.stage).toBe('APPROVED');
      const [pro] = await e2e.db.sql<{ status: string; onboarded_at: Date | null }[]>`
        SELECT status, onboarded_at FROM photographers WHERE id = ${photographerId}`;
      expect(pro?.status).toBe('ACTIVE');
      expect(pro?.onboarded_at).not.toBeNull();
      const back = await post('admin', path, { toStage: 'SCREENING', note: 'Oops' });
      expect(back.json.error.code).toBe('APPLICATION_MOVE_NOT_ALLOWED');
    });
  });

  describe('directory, penalties and status', () => {
    let penaltyId: string;

    beforeAll(async () => {
      await insertPhotographer(e2e.db.sql, { phone: '+919825088010', name: 'Bhavin Shah' });
      const [row] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO photographer_penalties (photographer_id, kind, severity, note, created_at)
        VALUES (${photographerId}, 'NO_SHOW', 1, 'no-show on a test booking', ${e2e.now()})
        RETURNING id`;
      penaltyId = row?.id ?? '';
    });

    it('searches by name or phone, alphabetically, phones masked for read-only', async () => {
      const all = await get('ops', '/admin/supply/photographers?limit=10');
      expect((all.json.data.items as Json[]).map((r) => r.fullName)).toEqual([
        'Asha Patel',
        'Bhavin Shah',
      ]);
      const byPhone = await get('ops', '/admin/supply/photographers?q=88010');
      expect((byPhone.json.data.items as Json[]).map((r) => r.fullName)).toEqual(['Bhavin Shah']);
      const paged = await get('ops', '/admin/supply/photographers?limit=1');
      const next = await get(
        'ops',
        `/admin/supply/photographers?limit=1&cursor=${paged.json.data.nextCursor}`,
      );
      expect(next.json.data.items[0].fullName).toBe('Bhavin Shah');
      const ro = await get('readOnly', '/admin/supply/photographers?q=Asha');
      expect(ro.json.data.items[0].phone).toMatch(/\*/);
      // Masked digits cannot be recovered by searching for them.
      const probe = await get('readOnly', '/admin/supply/photographers?q=825088');
      expect(probe.json.data.items).toEqual([]);
    });

    it('the profile shows verification (masked), documents and penalties', async () => {
      const res = await get('qm', `/admin/supply/photographers/${photographerId}`);
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({
        status: 'ACTIVE',
        activePenalties: 1,
        application: { id: applicationId, stage: 'APPROVED' },
      });
      expect(res.json.data.penalties[0]).toMatchObject({ kind: 'NO_SHOW', waived: false });
      expect((await get('cmMumbai', `/admin/supply/photographers/${photographerId}`)).status).toBe(
        404,
      );
    });

    it('a city manager or the QM waives a penalty with a reason, once', async () => {
      const path = `/admin/supply/penalties/${penaltyId}/waive`;
      expect((await post('ops', path, { reason: 'Verified emergency' })).status).toBe(403);
      expect((await post('qm', path, { reason: '' })).status).toBe(400);
      const res = await post('qm', path, { reason: 'Verified medical emergency (ADR-0013)' });
      expect(res.status).toBe(200);
      expect(res.json.data).toMatchObject({ waived: true });
      expect((await post('cmSurat', path, { reason: 'again' })).json.error.code).toBe(
        'PENALTY_ALREADY_WAIVED',
      );
      expect((await auditRows('penalty.waive')).at(-1)).toMatchObject({
        actor_id: staff.qm,
        entity_id: penaltyId,
      });
    });

    it('a city manager pauses and reactivates; offboarding is final', async () => {
      const path = `/admin/supply/photographers/${photographerId}/status`;
      expect((await post('ops', path, { action: 'PAUSE', reason: 'Leave' })).status).toBe(403);
      const paused = await post('cmSurat', path, {
        action: 'PAUSE',
        reason: 'On leave for a week',
      });
      expect(paused.json.data.status).toBe('PAUSED');
      const back = await post('cmSurat', path, { action: 'REACTIVATE', reason: 'Back from leave' });
      expect(back.json.data.status).toBe('ACTIVE');
      const off = await post('cmSurat', path, { action: 'OFFBOARD', reason: 'Moved cities' });
      expect(off.json.data.status).toBe('OFFBOARDED');
      const again = await post('cmSurat', path, { action: 'REACTIVATE', reason: 'Changed mind' });
      expect(again.json.error.code).toBe('STATUS_CHANGE_NOT_ALLOWED');
      expect((await auditRows('photographer.status')).length).toBe(3);
    });
  });
});
