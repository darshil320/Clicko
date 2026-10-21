import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const ADMIN_URL = process.env.DATABASE_URL;

// Needs `pnpm db:up`. Skipped (not failed) when no database is configured.
describe.runIf(ADMIN_URL)('migrations against a real Postgres + PostGIS', () => {
  const dbName = `clickco_test_${randomBytes(4).toString('hex')}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(ADMIN_URL as string, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const url = new URL(ADMIN_URL as string);
    url.pathname = `/${dbName}`;
    sql = postgres(url.toString(), { max: 1, onnotice: () => {} });
    await runMigrations(sql);
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin?.end();
  });

  it('records every migration exactly once and is idempotent on re-run', async () => {
    await runMigrations(sql);
    const rows = await sql`SELECT name FROM schema_migrations ORDER BY name`;
    expect(rows.map((r) => r.name)).toEqual([
      '0001_clickco_schema.sql',
      '0002_spec_audit_gaps.sql',
    ]);
  });

  it('creates the double-booking exclusion constraint on assignments', async () => {
    const rows = await sql`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'assignments'::regclass AND contype = 'x'`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('makes ledger_entries append-only', async () => {
    const triggers = await sql`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'ledger_entries'::regclass AND NOT tgisinternal`;
    expect(triggers.length).toBeGreaterThanOrEqual(2);
  });

  it('stores money only as bigint — no numeric column is named like money', async () => {
    const rows = await sql`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name ~ '_paise$' AND data_type <> 'bigint'`;
    expect(rows).toEqual([]);
  });

  it('creates the audit-gap tables from addendum 0002', async () => {
    const rows = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('equipment_claims','support_tickets','ticket_messages')
      ORDER BY table_name`;
    expect(rows.map((r) => r.table_name)).toEqual([
      'equipment_claims',
      'support_tickets',
      'ticket_messages',
    ]);
  });

  it('rejects an edit to a migration that has already been applied', async () => {
    await sql`UPDATE schema_migrations SET checksum = repeat('0', 64)
              WHERE name = '0002_spec_audit_gaps.sql'`;
    await expect(runMigrations(sql)).rejects.toThrow(/checksum/);
  });
});
