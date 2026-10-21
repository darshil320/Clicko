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

export async function runMigrations(
  sql: postgres.Sql,
  migrations: Migration[] = listMigrations(),
): Promise<string[]> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
  await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  try {
    const applied = new Map(
      (
        await sql<
          { name: string; checksum: string }[]
        >`SELECT name, checksum FROM schema_migrations`
      ).map((r) => [r.name, r.checksum]),
    );
    const newlyApplied: string[] = [];
    for (const m of migrations) {
      const previous = applied.get(m.name);
      if (previous !== undefined) {
        if (previous !== m.checksum) {
          throw new Error(
            `Migration ${m.name} was edited after being applied (checksum mismatch). ` +
              'Add a new migration instead of changing an applied one.',
          );
        }
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql);
        await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${m.name}, ${m.checksum})`;
      });
      newlyApplied.push(m.name);
    }
    return newlyApplied;
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const sql = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
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
