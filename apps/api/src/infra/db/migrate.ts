import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { loadEnv } from '../../config/env';

/**
 * Plain-SQL migration runner (ADR-0006). Applies migrations/NNNN_*.sql in order,
 * each in its own transaction, recording a sha256 checksum. An applied file
 * whose checksum changes is a hard error: migrations are immutable once run.
 */

const MIGRATIONS_DIR = join(__dirname, 'migrations');
const LOCK_KEY = 4_821_000; // pg_advisory_lock key; any constant unique to this runner

export interface Migration {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Refuses an unapplied migration that sorts before the newest applied one, and an
 * applied migration whose file is gone. Both mean history and disk disagree.
 */
function assertConsistentHistory(
  applied: ReadonlyMap<string, string>,
  migrations: Migration[],
): void {
  const onDisk = new Set(migrations.map((m) => m.name));
  const missing = [...applied.keys()].filter((name) => !onDisk.has(name));
  if (missing.length > 0) {
    throw new Error(`Applied migrations are missing from disk: ${missing.join(', ')}`);
  }
  const newestApplied = [...applied.keys()].sort().at(-1);
  const outOfOrder = migrations.filter(
    (m) => !applied.has(m.name) && newestApplied !== undefined && m.name < newestApplied,
  );
  if (outOfOrder.length > 0) {
    throw new Error(
      `Migrations out of order (numbered below applied ${newestApplied}): ` +
        outOfOrder.map((m) => m.name).join(', '),
    );
  }
}

async function applyPending(sql: postgres.ReservedSql, migrations: Migration[]): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
  const rows = await sql<{ name: string; checksum: string }[]>`
    SELECT name, checksum FROM schema_migrations`;
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  for (const m of migrations) {
    const previous = applied.get(m.name);
    if (previous !== undefined && previous !== m.checksum) {
      throw new Error(
        `Migration ${m.name} was edited after being applied (checksum mismatch). ` +
          'Add a new migration instead of changing an applied one.',
      );
    }
  }
  assertConsistentHistory(applied, migrations);

  const newlyApplied: string[] = [];
  for (const m of migrations.filter((x) => !applied.has(x.name))) {
    await sql.unsafe('BEGIN');
    try {
      await sql.unsafe(m.sql);
      await sql`INSERT INTO schema_migrations (name, checksum) VALUES (${m.name}, ${m.checksum})`;
      await sql.unsafe('COMMIT');
    } catch (error) {
      await sql.unsafe('ROLLBACK');
      throw error;
    }
    newlyApplied.push(m.name);
  }
  return newlyApplied;
}

/**
 * Lock, history checks, every migration and unlock all run on ONE reserved
 * connection: advisory locks are session-scoped, so a pooled unlock could land
 * on a different session and leave the lock held.
 */
export async function runMigrations(
  sql: postgres.Sql,
  migrations: Migration[] = listMigrations(),
): Promise<string[]> {
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_advisory_lock(${LOCK_KEY})`;
    try {
      return await applyPending(conn, migrations);
    } finally {
      try {
        await conn`SELECT pg_advisory_unlock(${LOCK_KEY})`;
      } catch (unlockError) {
        // Never mask the migration error; the lock dies with the session anyway.
        process.stderr.write(
          `Warning: advisory unlock failed: ${unlockError instanceof Error ? unlockError.message : String(unlockError)}\n`,
        );
      }
    }
  } finally {
    conn.release();
  }
}

/** The integration suite creates and force-drops databases; never let it near a shared server. */
export function assertLocalTestDatabase(url: string, name = 'TEST_DATABASE_URL'): void {
  const host = new URL(url).hostname;
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error(`${name} must point at localhost, got host "${host}"`);
  }
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  // Security audit M4: migrations run as the table owner; the API itself runs as clickco_app.
  const sql = postgres(env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  try {
    const applied = await runMigrations(sql);
    process.stdout.write(
      applied.length ? `Applied: ${applied.join(', ')}\n` : 'Database is up to date.\n',
    );
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `Migration failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
}
