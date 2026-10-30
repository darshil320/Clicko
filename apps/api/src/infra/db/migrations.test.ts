import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMigrations } from './migrate';
import { applySpecPatches, SPEC_PATCHES } from './spec-patches';

const ROOT = join(__dirname, '../../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('migrations mirror the specification (ADR-0006)', () => {
  it('0001 is docs/clickco-04-schema.sql plus only the documented spec patches', () => {
    expect(read('apps/api/src/infra/db/migrations/0001_clickco_schema.sql')).toBe(
      applySpecPatches(read('docs/clickco-04-schema.sql')),
    );
  });

  it('every spec patch is logged as a finding in docs/SPEC-AUDIT.md', () => {
    const audit = read('docs/SPEC-AUDIT.md');
    for (const p of SPEC_PATCHES) expect(audit).toContain(`| ${p.finding} |`);
  });

  it('refuses a patch whose target no longer appears exactly once', () => {
    expect(() =>
      applySpecPatches('nothing here', [{ finding: 'X', reason: '', find: 'absent', replace: '' }]),
    ).toThrow(/exactly one match/);
  });

  it('0002 is byte-identical to docs/schema-addenda/0002-spec-audit-gaps.sql', () => {
    expect(read('apps/api/src/infra/db/migrations/0002_spec_audit_gaps.sql')).toBe(
      read('docs/schema-addenda/0002-spec-audit-gaps.sql'),
    );
  });

  it('0003 is byte-identical to docs/schema-addenda/0003-booking-consent.sql', () => {
    expect(read('apps/api/src/infra/db/migrations/0003_booking_consent.sql')).toBe(
      read('docs/schema-addenda/0003-booking-consent.sql'),
    );
  });

  it('0004 is byte-identical to docs/schema-addenda/0004-outbox-backoff.sql', () => {
    expect(read('apps/api/src/infra/db/migrations/0004_outbox_backoff.sql')).toBe(
      read('docs/schema-addenda/0004-outbox-backoff.sql'),
    );
  });

  it('0005 is byte-identical to docs/schema-addenda/0005-credit-notes.sql', () => {
    expect(read('apps/api/src/infra/db/migrations/0005_credit_notes.sql')).toBe(
      read('docs/schema-addenda/0005-credit-notes.sql'),
    );
  });

  it('0006 is byte-identical to docs/schema-addenda/0006-review-resolutions.sql', () => {
    expect(read('apps/api/src/infra/db/migrations/0006_review_resolutions.sql')).toBe(
      read('docs/schema-addenda/0006-review-resolutions.sql'),
    );
  });

  it('lists migrations in numeric order with a sha256 checksum each', () => {
    const migrations = listMigrations();
    expect(migrations.map((m) => m.name)).toEqual([
      '0001_clickco_schema.sql',
      '0002_spec_audit_gaps.sql',
      '0003_booking_consent.sql',
      '0004_outbox_backoff.sql',
      '0005_credit_notes.sql',
      '0006_review_resolutions.sql',
      '0007_staff_passwords.sql',
      '0009_payout_deductions.sql',
      '0010_pricing_drafts.sql',
    ]);
    for (const m of migrations) expect(m.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});
