import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applySpecPatches } from './spec-patches';

// Regenerates migrations 0001–0004 from the specification files. Never hand-edit them.
const ROOT = join(__dirname, '../../../../..');
const MIGRATIONS = join(__dirname, 'migrations');

const spec = readFileSync(join(ROOT, 'docs/clickco-04-schema.sql'), 'utf8');
writeFileSync(join(MIGRATIONS, '0001_clickco_schema.sql'), applySpecPatches(spec));
writeFileSync(
  join(MIGRATIONS, '0002_spec_audit_gaps.sql'),
  readFileSync(join(ROOT, 'docs/schema-addenda/0002-spec-audit-gaps.sql'), 'utf8'),
);
writeFileSync(
  join(MIGRATIONS, '0003_booking_consent.sql'),
  readFileSync(join(ROOT, 'docs/schema-addenda/0003-booking-consent.sql'), 'utf8'),
);
writeFileSync(
  join(MIGRATIONS, '0004_outbox_backoff.sql'),
  readFileSync(join(ROOT, 'docs/schema-addenda/0004-outbox-backoff.sql'), 'utf8'),
);
writeFileSync(
  join(MIGRATIONS, '0005_credit_notes.sql'),
  readFileSync(join(ROOT, 'docs/schema-addenda/0005-credit-notes.sql'), 'utf8'),
);
writeFileSync(
  join(MIGRATIONS, '0006_review_resolutions.sql'),
  readFileSync(join(ROOT, 'docs/schema-addenda/0006-review-resolutions.sql'), 'utf8'),
);
process.stdout.write('Migrations 0001–0006 regenerated from docs/.\n');
