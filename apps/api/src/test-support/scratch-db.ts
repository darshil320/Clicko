import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { assertLocalTestDatabase, runMigrations } from '../infra/db/migrate';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface ScratchDb {
  readonly url: string;
  readonly sql: postgres.Sql;
  drop(): Promise<void>;
}

/** A fresh, fully migrated database on the local test server. Integration tests only. */
export async function createScratchDb(): Promise<ScratchDb> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  assertLocalTestDatabase(TEST_DATABASE_URL);
  const name = `clickco_test_${randomBytes(4).toString('hex')}`;
  const admin = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 4, onnotice: () => {} });
  await runMigrations(sql);
  return {
    url: url.toString(),
    sql,
    async drop() {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
