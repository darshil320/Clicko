import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedLaunchCities } from '../../../infra/db/seed';
import type { StoragePort } from '../../../infra/storage/storage.port';
import { insertPhotographer, proPhone } from '../../../test-support/photographer-fixtures';
import {
  createScratchDb,
  type ScratchDb,
  TEST_DATABASE_URL,
} from '../../../test-support/scratch-db';
import { PhotographerDirectoryService } from '../directory.service';
import { KYC_EVENTS, KYC_RETENTION, kycPurgeAfter } from '../kyc-retention.config';
import { KycRetentionService } from '../kyc-retention.service';
import { OnboardingService } from '../onboarding.service';
import { DirectoryRepository } from '../repositories/directory.repository';
import { KycRepository } from '../repositories/kyc.repository';
import { OnboardingRepository } from '../repositories/onboarding.repository';

// 14 Nov 2026, 12:00 IST.
const NOW = new Date('2026-11-14T06:30:00.000Z');
const DAY = 86_400_000;
const noAudit = async () => {};

interface DocRow {
  id: string;
  purge_after: string | null;
  purged_at: Date | null;
  reference_last4: string | null;
  original_filename: string | null;
  review_note: string | null;
}

describe.runIf(TEST_DATABASE_URL)('KYC document retention (DPDP s.8(7))', () => {
  let db: ScratchDb;
  let now = NOW;
  let suratId: string;
  let seq = 0;
  const deleted: string[] = [];
  const failing = new Set<string>();
  let retention: KycRetentionService;
  let directory: PhotographerDirectoryService;
  let onboarding: OnboardingService;

  const storage = {
    permanentlyDelete: async (ids: readonly string[]) => {
      for (const id of ids) {
        if (failing.has(id)) throw new Error('provider unavailable');
        deleted.push(id);
      }
    },
  } as unknown as StoragePort;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    db = await createScratchDb();
    await seedLaunchCities(db.sql);
    const [surat] = await db.sql<{ id: string }[]>`SELECT id FROM cities WHERE name = 'Surat'`;
    suratId = surat?.id ?? '';
    const kyc = new KycRepository();
    retention = new KycRetentionService(db.sql, kyc, storage, () => now);
    directory = new PhotographerDirectoryService(db.sql, new DirectoryRepository(), kyc, retention);
    onboarding = new OnboardingService(db.sql, new OnboardingRepository(), kyc, retention);
  }, 60_000);

  afterAll(async () => {
    await db?.drop();
  });

  const insertDoc = async (
    photographerId: string,
    o: { purgedAt?: Date; purgeAfter?: string } = {},
  ): Promise<string> => {
    const [row] = await db.sql<{ id: string }[]>`
      INSERT INTO photographer_documents (photographer_id, kind, storage_key, original_filename,
        mime_type, size_bytes, reference_last4, purge_after, purged_at)
      VALUES (${photographerId}, 'PAN_CARD', ${`kyc-obj-${++seq}`}, 'ABCDE1234F.pdf',
              'application/pdf', 1024, '234F', ${o.purgeAfter ?? null}, ${o.purgedAt ?? null})
      RETURNING id`;
    if (!row) throw new Error('insertDoc');
    return row.id;
  };
  const docsOf = (photographerId: string) =>
    db.sql<DocRow[]>`
      SELECT id, purge_after::text AS purge_after, purged_at, reference_last4, original_filename,
             review_note
      FROM photographer_documents WHERE photographer_id = ${photographerId} ORDER BY id`;
  const doc = async (id: string): Promise<DocRow> => {
    const [row] = await db.sql<DocRow[]>`
      SELECT id, purge_after::text AS purge_after, purged_at, reference_last4, original_filename,
             review_note
      FROM photographer_documents WHERE id = ${id}`;
    if (!row) throw new Error('doc');
    return row;
  };
  const events = (type: string, aggregateId: string) =>
    db.sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM domain_events WHERE event_type = ${type} AND aggregate_id = ${aggregateId}`;
  const applicant = async () => {
    const card = await onboarding.createApplicant({
      applicant: {
        fullName: 'Applicant',
        phone: proPhone(++seq),
        cityId: suratId,
        source: 'WALK_IN',
        portfolioUrl: null,
        yearsExperience: null,
        requestedMaxTier: null,
        note: null,
      },
      staffId: await staffId(),
      now,
      auditFor: () => noAudit,
    });
    return card;
  };
  let staff: string | null = null;
  const staffId = async (): Promise<string> => {
    if (staff) return staff;
    const [row] = await db.sql<{ id: string }[]>`
      INSERT INTO staff_users (email, full_name, password_hash, is_active)
      VALUES ('kyc-retention@clickco.invalid', 'Retention test', '!', false) RETURNING id`;
    staff = row?.id ?? '';
    return staff;
  };
  const move = async (id: string, to: 'REJECTED' | 'WITHDRAWN' | 'SCREENING') =>
    onboarding.move({
      id,
      to,
      note: `to ${to}`,
      staffId: await staffId(),
      scope: 'ALL',
      canDecide: () => true,
      now,
      audit: noAudit,
    });

  describe('scheduling when the relationship ends', () => {
    it('offboarding sets purge_after on unpurged documents only, with an outbox event', async () => {
      const pro = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      const live = await insertDoc(pro);
      const gone = await insertDoc(pro, { purgedAt: new Date(NOW.getTime() - DAY) });
      await directory.changeStatus({
        id: pro,
        action: 'OFFBOARD',
        reason: 'Moved cities',
        scope: 'ALL',
        now,
        audit: noAudit,
      });
      const expected = kycPurgeAfter(now, KYC_RETENTION.daysAfterRelationshipEnds);
      expect((await doc(live)).purge_after).toBe(expected);
      expect((await doc(gone)).purge_after).toBeNull();
      const [event] = await events(KYC_EVENTS.SCHEDULED, pro);
      expect(event?.payload).toMatchObject({
        photographer_id: pro,
        purge_after: expected,
        documents: 1,
        reason: 'OFFBOARDED',
      });
    });

    it('pausing or suspending does not end the relationship', async () => {
      const pro = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      const d = await insertDoc(pro);
      for (const action of ['PAUSE', 'SUSPEND'] as const) {
        await directory.changeStatus({
          id: pro,
          action,
          reason: action,
          scope: 'ALL',
          now,
          audit: noAudit,
        });
      }
      expect((await doc(d)).purge_after).toBeNull();
      expect(await events(KYC_EVENTS.SCHEDULED, pro)).toHaveLength(0);
    });

    it('a rejected application schedules the purge; reopening it cancels the purge', async () => {
      const card = await applicant();
      const d = await insertDoc(card.photographerId);
      await move(card.id, 'REJECTED');
      expect((await doc(d)).purge_after).toBe(
        kycPurgeAfter(now, KYC_RETENTION.daysAfterApplicationClosed),
      );
      expect((await events(KYC_EVENTS.SCHEDULED, card.photographerId))[0]?.payload).toMatchObject({
        reason: 'APPLICATION_REJECTED',
        documents: 1,
      });
      await move(card.id, 'SCREENING');
      expect((await doc(d)).purge_after).toBeNull();
      expect(await events(KYC_EVENTS.CANCELLED, card.photographerId)).toHaveLength(1);
    });

    it('a withdrawn application schedules the purge too', async () => {
      const card = await applicant();
      const d = await insertDoc(card.photographerId);
      await move(card.id, 'WITHDRAWN');
      expect((await doc(d)).purge_after).not.toBeNull();
      expect((await events(KYC_EVENTS.SCHEDULED, card.photographerId))[0]?.payload).toMatchObject({
        reason: 'APPLICATION_WITHDRAWN',
      });
    });
  });

  describe('the purge sweep', () => {
    it('deletes due files through StoragePort, erases the identifiers and is safe to rerun', async () => {
      await db.sql`UPDATE photographer_documents SET purge_after = NULL`;
      const off = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      await db.sql`UPDATE photographers SET status = 'OFFBOARDED', offboarded_at = ${now} WHERE id = ${off}`;
      const today = kycPurgeAfter(now, 0);
      const dueA = await insertDoc(off, { purgeAfter: today });
      const dueB = await insertDoc(off, { purgeAfter: kycPurgeAfter(now, -10) });
      const later = await insertDoc(off, { purgeAfter: kycPurgeAfter(now, 1) });
      // An ACTIVE photographer is never purged, whatever a stray purge_after says.
      const active = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      const activeDoc = await insertDoc(active, { purgeAfter: today });
      const keyOf = async (id: string) =>
        (
          await db.sql<{ storage_key: string }[]>`
          SELECT storage_key FROM photographer_documents WHERE id = ${id}`
        )[0]?.storage_key;
      const keyA = await keyOf(dueA);
      const keyB = await keyOf(dueB);
      deleted.length = 0;

      expect(await retention.sweep()).toEqual({ purged: 2, failed: 0 });
      expect([...deleted].sort()).toEqual([keyA, keyB].sort());
      for (const id of [dueA, dueB]) {
        const row = await doc(id);
        expect(row.purged_at).toEqual(now);
        expect(row.reference_last4).toBeNull();
        expect(row.original_filename).toBeNull();
        expect(await events(KYC_EVENTS.PURGED, id)).toHaveLength(1);
      }
      expect((await doc(later)).purged_at).toBeNull();
      expect((await doc(activeDoc)).purged_at).toBeNull();
      expect((await docsOf(off)).filter((r) => r.purged_at === null)).toHaveLength(1);

      deleted.length = 0;
      expect(await retention.sweep()).toEqual({ purged: 0, failed: 0 });
      expect(deleted).toEqual([]);
      expect(await events(KYC_EVENTS.PURGED, dueA)).toHaveLength(1);
    });

    it('a failing file stays unpurged for the next run; the rest of the batch goes', async () => {
      await db.sql`UPDATE photographer_documents SET purge_after = NULL WHERE purged_at IS NULL`;
      const off = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      await db.sql`UPDATE photographers SET status = 'OFFBOARDED', offboarded_at = ${now} WHERE id = ${off}`;
      const today = kycPurgeAfter(now, 0);
      const bad = await insertDoc(off, { purgeAfter: today });
      const good = await insertDoc(off, { purgeAfter: today });
      const [badRow] = await db.sql<{ storage_key: string }[]>`
        SELECT storage_key FROM photographer_documents WHERE id = ${bad}`;
      failing.add(badRow?.storage_key ?? '');

      expect(await retention.sweep()).toEqual({ purged: 1, failed: 1 });
      expect((await doc(bad)).purged_at).toBeNull();
      expect((await doc(bad)).reference_last4).toBe('234F');
      expect((await doc(good)).purged_at).not.toBeNull();

      failing.clear();
      expect(await retention.sweep()).toEqual({ purged: 1, failed: 0 });
      expect((await doc(bad)).purged_at).not.toBeNull();
    });

    it('takes at most one batch per run', async () => {
      await db.sql`UPDATE photographer_documents SET purge_after = NULL WHERE purged_at IS NULL`;
      const off = await insertPhotographer(db.sql, { phone: proPhone(++seq) });
      await db.sql`UPDATE photographers SET status = 'OFFBOARDED', offboarded_at = ${now} WHERE id = ${off}`;
      const today = kycPurgeAfter(now, 0);
      for (let i = 0; i < KYC_RETENTION.purgeBatch + 2; i += 1) {
        await insertDoc(off, { purgeAfter: today });
      }
      expect(await retention.sweep()).toEqual({ purged: KYC_RETENTION.purgeBatch, failed: 0 });
      expect(await retention.sweep()).toEqual({ purged: 2, failed: 0 });
    });

    it('purges a rejected applicant once the period has run', async () => {
      const card = await applicant();
      const d = await insertDoc(card.photographerId);
      await move(card.id, 'REJECTED');
      expect(await retention.sweep()).toEqual({ purged: 0, failed: 0 });
      now = new Date(NOW.getTime() + (KYC_RETENTION.daysAfterApplicationClosed + 1) * DAY);
      try {
        const result = await retention.sweep();
        expect(result.purged).toBeGreaterThanOrEqual(1);
        expect((await doc(d)).purged_at).toEqual(now);
      } finally {
        now = NOW;
      }
    });
  });
});
