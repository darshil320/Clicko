import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type E2eApp, startE2eApp } from '../../../test-support/e2e-app';
import { insertClient } from '../../../test-support/onsite-fixtures';
import { TEST_DATABASE_URL } from '../../../test-support/scratch-db';
import { bootstrapStaff, cityIdOf } from '../../../test-support/staff-fixtures';
import { ModerationService } from '../moderation.service';

const NOW = new Date('2026-12-07T04:30:00.000Z');

/**
 * ADR-0027 D4: a city's moderation desk sees only its cities' decisions about a person — a
 * client reported in Surat and in Mumbai has two records, and each city manager sees their own.
 */
describe.runIf(TEST_DATABASE_URL)('moderation history is city-scoped', () => {
  let e2e: E2eApp;
  let surat: string;
  let mumbai: string;
  let mumbaiReport: string;

  beforeAll(async () => {
    e2e = await startE2eApp({ now: NOW, nodeEnv: 'test' });
    surat = await cityIdOf(e2e, 'Surat');
    mumbai = await cityIdOf(e2e, 'Mumbai');
    const staffId = (await bootstrapStaff(e2e, 'qm@clickco.test', 'QUALITY_MANAGER')).id;
    const reported = await insertClient(e2e, '+919999389101');
    const report = async (cityId: string, status: 'OPEN' | 'ACTIONED') => {
      const decided = status === 'OPEN' ? null : { by: staffId, at: NOW };
      const [row] = await e2e.db.sql<{ id: string }[]>`
        INSERT INTO moderation_reports (reporter_kind, reporter_id, target_kind, target_id,
                                        city_id, reason, status, decision, decision_note,
                                        decided_by, decided_at)
        VALUES ('PHOTOGRAPHER', gen_random_uuid(), 'USER', ${reported}, ${cityId}, 'HARASSMENT',
                ${status}, ${decided ? 'WARN' : null}, ${decided ? 'Warned' : null},
                ${decided?.by ?? null}, ${decided?.at ?? null})
        RETURNING id`;
      return row?.id ?? '';
    };
    for (const cityId of [surat, mumbai]) {
      const decided = await report(cityId, 'ACTIONED');
      await e2e.db.sql`
        INSERT INTO moderation_actions (report_id, decision, target_kind, target_id, warned_kind,
                                        warned_id, staff_id, city_id, note, reports_closed)
        VALUES (${decided}, 'WARN', 'USER', ${reported}, 'USER', ${reported}, ${staffId},
                ${cityId}, ${`Warned in ${cityId === surat ? 'Surat' : 'Mumbai'}`}, 1)`;
    }
    mumbaiReport = await report(mumbai, 'OPEN');
  }, 60_000);

  afterAll(async () => {
    await e2e?.close();
  });

  it("a Mumbai-only caller sees Mumbai's decision and warning, not Surat's", async () => {
    const facts = await e2e.get(ModerationService).facts(mumbaiReport, [mumbai]);
    expect(facts.history.map((h) => h.note)).toEqual(['Warned in Mumbai']);
    expect(facts.person).toMatchObject({ kind: 'USER', warnings: 1 });
  });

  it('an all-cities caller sees both', async () => {
    const facts = await e2e.get(ModerationService).facts(mumbaiReport, 'ALL');
    expect(facts.history).toHaveLength(2);
    expect(facts.person).toMatchObject({ warnings: 2 });
  });
});
