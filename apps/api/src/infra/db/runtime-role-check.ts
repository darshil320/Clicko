import type postgres from 'postgres';
import type { Env } from '../../config/env';

/**
 * Security audit M4: the append-only triggers only hold if the API cannot drop or
 * disable them, i.e. if it does not connect as the table owner (or a superuser).
 * In staging and production the API refuses to boot as such a role. Locally the
 * single `clickco` superuser is expected, so the check is skipped there.
 */

export interface RuntimeRole {
  readonly roleName: string;
  readonly tableOwner: string;
  /** current_user is the owner of audit_logs or a member of the owning role. */
  readonly actsAsOwner: boolean;
  readonly superuser: boolean;
}

const ENFORCED_IN: ReadonlySet<Env['NODE_ENV']> = new Set(['staging', 'production']);

/** audit_logs stands in for every append-only table: one owner runs every migration. */
export async function readRuntimeRole(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<RuntimeRole> {
  const [row] = await sql<RuntimeRole[]>`
    SELECT current_user AS "roleName",
           pg_get_userbyid(c.relowner) AS "tableOwner",
           pg_has_role(current_user, c.relowner, 'MEMBER') AS "actsAsOwner",
           r.rolsuper AS superuser
      FROM pg_class c
      JOIN pg_roles r ON r.rolname = current_user
     WHERE c.oid = 'public.audit_logs'::regclass`;
  if (!row) throw new Error('Could not read the database role for the M4 runtime-role check');
  return row;
}

/** The reason this role must not run the API, or null when it is least-privilege. */
export function runtimeRoleProblem(role: RuntimeRole): string | null {
  if (role.superuser) return `database role "${role.roleName}" is a superuser`;
  if (role.actsAsOwner) {
    return `database role "${role.roleName}" owns audit_logs (owner "${role.tableOwner}")`;
  }
  return null;
}

/** Throws (failing boot) in staging/production when the runtime role could bypass append-only. */
export async function checkRuntimeRole(
  read: () => Promise<RuntimeRole>,
  nodeEnv: Env['NODE_ENV'],
): Promise<void> {
  if (!ENFORCED_IN.has(nodeEnv)) return;
  const problem = runtimeRoleProblem(await read());
  if (problem === null) return;
  throw new Error(
    `Refusing to start in ${nodeEnv}: ${problem}, so it could disable the append-only triggers ` +
      '(security audit M4). Point DATABASE_URL at a LOGIN role that is a member of clickco_app; ' +
      'the owner belongs only in MIGRATION_DATABASE_URL. See apps/api/CLAUDE.md.',
  );
}
