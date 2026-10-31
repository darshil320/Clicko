import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScratchDb, type ScratchDb, TEST_DATABASE_URL } from '../../test-support/scratch-db';
import { listMigrations } from './migrate';
import { readRuntimeRole } from './runtime-role-check';

/** Tables whose rows are evidence: the app may add to them, never rewrite or remove. */
const APPEND_ONLY = [
  'audit_logs',
  'ledger_entries',
  'credit_notes',
  'review_resolutions',
  'booking_status_events',
  'assignment_events',
  'photographer_application_events',
  'ticket_messages',
  'booking_price_snapshots',
] as const;

const APP_ROLE = 'clickco_app';
const PERMISSION_DENIED = /permission denied/;

// Needs `pnpm db:up` and TEST_DATABASE_URL. Skipped (not failed) otherwise.
describe.runIf(TEST_DATABASE_URL)(
  'append-only hardening (security audit M4, migration 0011)',
  () => {
    let db: ScratchDb;

    /** Runs `fn` as the least-privilege app role; SET LOCAL ends with the transaction. */
    const asApp = <T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
      db.sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${APP_ROLE}`);
        return fn(tx);
      }) as Promise<T>;

    const canApp = async (table: string, privilege: string): Promise<boolean> => {
      const [row] = await db.sql<{ ok: boolean }[]>`
      SELECT has_table_privilege(${APP_ROLE}, ${table}, ${privilege}) AS ok`;
      return row?.ok ?? false;
    };

    beforeAll(async () => {
      db = await createScratchDb();
    }, 60_000);

    afterAll(async () => {
      await db?.drop();
    });

    it.each(APPEND_ONLY)('M4: TRUNCATE on an append-only table is refused (%s)', async (table) => {
      await expect(db.sql.unsafe(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/append-only/);
    });

    it('M4: every table with an append-only UPDATE/DELETE trigger also refuses TRUNCATE', async () => {
      // tgtype bits: 8 = DELETE, 16 = UPDATE, 32 = TRUNCATE.
      const rows = await db.sql<{ table: string; truncate_guarded: boolean }[]>`
      SELECT c.relname AS table,
             bool_or(t.tgtype & 32 <> 0) AS truncate_guarded
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
       WHERE NOT t.tgisinternal
         AND p.proname IN ('forbid_mutation', 'forbid_update')
       GROUP BY c.relname
       ORDER BY c.relname`;
      expect(rows.length).toBeGreaterThanOrEqual(APPEND_ONLY.length);
      expect(rows.filter((r) => !r.truncate_guarded)).toEqual([]);
    });

    it('M4: the app role may INSERT into audit_logs', async () => {
      const [row] = await asApp(
        (tx) => tx<{ id: string }[]>`
        INSERT INTO audit_logs (actor_kind, action, entity_kind)
        VALUES ('SYSTEM', 'm4.test', 'test') RETURNING id`,
      );
      expect(row?.id).toBeDefined();
    });

    it.each([
      ['UPDATE', `UPDATE audit_logs SET action = 'rewritten'`],
      ['DELETE', 'DELETE FROM audit_logs'],
      ['TRUNCATE', 'TRUNCATE audit_logs'],
    ])('M4: the app role is permission-denied %s on audit_logs', async (_op, statement) => {
      await expect(asApp((tx) => tx.unsafe(statement))).rejects.toThrow(PERMISSION_DENIED);
    });

    it.each(APPEND_ONLY)('M4: the app role holds only SELECT and INSERT on %s', async (table) => {
      expect(await canApp(table, 'SELECT')).toBe(true);
      expect(await canApp(table, 'INSERT')).toBe(true);
      expect(await canApp(table, 'UPDATE')).toBe(false);
      expect(await canApp(table, 'DELETE')).toBe(false);
      expect(await canApp(table, 'TRUNCATE')).toBe(false);
    });

    it('M4: the app role keeps UPDATE and DELETE on an ordinary table', async () => {
      await expect(
        asApp(async (tx) => {
          await tx`UPDATE users SET updated_at = now() WHERE false`;
          await tx`DELETE FROM idempotency_keys WHERE false`;
        }),
      ).resolves.toBeUndefined();
      expect(await canApp('users', 'TRUNCATE')).toBe(false);
    });

    it('M4: the outbox may mark events published but not rewrite or delete them', async () => {
      await expect(
        asApp(async (tx) => {
          await tx`SELECT id FROM domain_events WHERE false FOR UPDATE SKIP LOCKED`;
          await tx`UPDATE domain_events
                    SET published_at = now(), publish_attempts = 1,
                        last_error = 'x', next_attempt_at = now()
                  WHERE false`;
        }),
      ).resolves.toBeUndefined();
      await expect(
        asApp((tx) => tx`UPDATE domain_events SET payload = '{}'::jsonb WHERE false`),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(asApp((tx) => tx`DELETE FROM domain_events WHERE false`)).rejects.toThrow(
        PERMISSION_DENIED,
      );
    });

    it('M4: invoices can be locked and cancelled but never re-priced or deleted', async () => {
      await expect(
        asApp(async (tx) => {
          await tx`SELECT id FROM invoices WHERE false FOR UPDATE`;
          await tx`UPDATE invoices SET cancelled_at = now(), cancellation_note = 'x',
                                     pdf_storage_key = 'k' WHERE false`;
        }),
      ).resolves.toBeUndefined();
      await expect(
        asApp((tx) => tx`UPDATE invoices SET total_amount_paise = 1 WHERE false`),
      ).rejects.toThrow(PERMISSION_DENIED);
      await expect(asApp((tx) => tx`DELETE FROM invoices WHERE false`)).rejects.toThrow(
        PERMISSION_DENIED,
      );
    });

    it('M4: the app role can read schema_migrations but not write it', async () => {
      expect(await canApp('schema_migrations', 'SELECT')).toBe(true);
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
        expect(await canApp('schema_migrations', privilege)).toBe(false);
      }
    });

    it('M4: the app role can draw ids from bigserial sequences', async () => {
      const [row] = await db.sql<{ ok: boolean }[]>`
      SELECT has_sequence_privilege(${APP_ROLE}, 'audit_logs_id_seq', 'USAGE') AS ok`;
      expect(row?.ok).toBe(true);
    });

    it('M4: a table created by a later migration gets the default app grants', async () => {
      await db.sql
        .begin(async (tx) => {
          await tx`CREATE TABLE m4_later (id bigserial PRIMARY KEY)`;
          const [row] = await tx<{ upd: boolean; trunc: boolean; seq: boolean }[]>`
          SELECT has_table_privilege(${APP_ROLE}, 'm4_later', 'UPDATE') AS upd,
                 has_table_privilege(${APP_ROLE}, 'm4_later', 'TRUNCATE') AS trunc,
                 has_sequence_privilege(${APP_ROLE}, 'm4_later_id_seq', 'USAGE') AS seq`;
          expect(row).toEqual({ upd: true, trunc: false, seq: true });
          throw new Error('rollback');
        })
        .catch((error: unknown) => {
          if (!(error instanceof Error) || error.message !== 'rollback') throw error;
        });
    });

    it('M4: re-running migration 0011 is safe and leaves the same grants', async () => {
      const m = listMigrations().find((x) => x.name.startsWith('0011_'));
      expect(m).toBeDefined();
      await db.sql.begin((tx) => tx.unsafe(m?.sql ?? ''));
      expect(await canApp('audit_logs', 'INSERT')).toBe(true);
      expect(await canApp('audit_logs', 'UPDATE')).toBe(false);
      expect(await canApp('users', 'UPDATE')).toBe(true);
      await expect(db.sql`TRUNCATE audit_logs`).rejects.toThrow(/append-only/);
    });

    it('M4: the boot check sees the migrating role as the owner and clickco_app as not', async () => {
      const owner = await readRuntimeRole(db.sql);
      expect(owner.actsAsOwner || owner.superuser).toBe(true);
      const app = await asApp((tx) => readRuntimeRole(tx));
      expect(app).toMatchObject({ roleName: APP_ROLE, actsAsOwner: false, superuser: false });
    });
  },
);
