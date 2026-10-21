import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLocalTestDatabase, listMigrations, runMigrations } from './migrate';

const ADMIN_URL = process.env.TEST_DATABASE_URL;

describe('assertLocalTestDatabase', () => {
  it('accepts localhost and 127.0.0.1', () => {
    expect(() => assertLocalTestDatabase('postgres://u:p@localhost:5433/db')).not.toThrow();
    expect(() => assertLocalTestDatabase('postgres://u:p@127.0.0.1:5433/db')).not.toThrow();
  });

  it('refuses any other host, because the suite creates and force-drops databases', () => {
    expect(() => assertLocalTestDatabase('postgres://u:p@db.railway.internal:5432/db')).toThrow(
      /localhost/,
    );
  });
});

// Needs `pnpm db:up` and TEST_DATABASE_URL. Skipped (not failed) otherwise.
describe.runIf(ADMIN_URL)('migrations against a real Postgres + PostGIS', () => {
  const dbName = `clickco_test_${randomBytes(4).toString('hex')}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;

  beforeAll(async () => {
    assertLocalTestDatabase(ADMIN_URL as string);
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

  it('refuses a new migration numbered below one already applied', async () => {
    const outOfOrder = [
      { name: '0000_sneaky.sql', sql: 'SELECT 1', checksum: 'a'.repeat(64) },
      ...listMigrations(),
    ];
    await expect(runMigrations(sql, outOfOrder)).rejects.toThrow(/out of order/);
  });

  it('refuses to run when an applied migration file has disappeared', async () => {
    await expect(runMigrations(sql, listMigrations().slice(0, 1))).rejects.toThrow(/missing/);
  });

  it('rolls back a failing migration and leaves no record of it', async () => {
    const broken = [
      ...listMigrations(),
      {
        name: '0099_broken.sql',
        sql: 'CREATE TABLE half_done (id int); SELECT nope;',
        checksum: 'b'.repeat(64),
      },
    ];
    await expect(runMigrations(sql, broken)).rejects.toThrow();
    const [row] = await sql`SELECT to_regclass('half_done') AS t,
      (SELECT count(*)::int FROM schema_migrations WHERE name = '0099_broken.sql') AS n`;
    expect(row).toEqual({ t: null, n: 0 });
  });

  it('rejects an edit to a migration that has already been applied', async () => {
    await sql`UPDATE schema_migrations SET checksum = repeat('0', 64)
              WHERE name = '0002_spec_audit_gaps.sql'`;
    await expect(runMigrations(sql)).rejects.toThrow(/checksum/);
  });
});
