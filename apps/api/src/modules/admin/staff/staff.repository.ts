import type { StaffRole } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { StaffGrantRecord } from '../access/staff-context';

export type Db = postgres.ISql;
export type Tx = postgres.TransactionSql;

export interface StaffRecord {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly passwordHash: string;
  /** AES-256-GCM sealed (SecretBox); null until TOTP is enrolled. */
  readonly totpSecret: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  /** ADR-0026 D7: the password is a temporary one; the next sign-in must replace it. */
  readonly mustChangePassword: boolean;
  /** When the temporary password stops working (set exactly when `mustChangePassword`). */
  readonly tempPasswordExpiresAt: Date | null;
  readonly passwordChangedAt: Date | null;
  /** The session epoch: access tokens issued before it are refused (StaffGuard). */
  readonly sessionsValidAfter: Date | null;
}

interface Row {
  id: string;
  email: string;
  full_name: string;
  password_hash: string;
  totp_secret: string | null;
  is_active: boolean;
  last_login_at: Date | null;
  must_change_password: boolean;
  temp_password_expires_at: Date | null;
  password_changed_at: Date | null;
  sessions_valid_after: Date | null;
}

const COLUMNS = `id, email, full_name, password_hash, totp_secret, is_active, last_login_at,
  must_change_password, temp_password_expires_at, password_changed_at, sessions_valid_after`;

const toRecord = (r: Row): StaffRecord => ({
  id: r.id,
  email: r.email,
  fullName: r.full_name,
  passwordHash: r.password_hash,
  totpSecret: r.totp_secret,
  isActive: r.is_active,
  lastLoginAt: r.last_login_at,
  mustChangePassword: r.must_change_password,
  tempPasswordExpiresAt: r.temp_password_expires_at,
  passwordChangedAt: r.password_changed_at,
  sessionsValidAfter: r.sessions_valid_after,
});

/** How a password is being set (ADR-0026 D7). */
export type PasswordKind =
  /** Issued by the system (new account, reset): must be replaced before this instant. */
  | { readonly temporaryUntil: Date }
  /** Chosen by the person (or a development seed's known password). */
  | { readonly chosenAt: Date | null };

/** Postgres SQLSTATEs mapped to 409 / 422 by the service. */
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';

const sqlState = (error: unknown): string | null =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : null;

/** staff_users and staff_role_grants (schema §2) — owned by the admin module. */
@Injectable()
export class StaffRepository {
  async findByEmail(db: Db, email: string): Promise<StaffRecord | null> {
    const [row] = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM staff_users WHERE lower(email) = lower(${email})`;
    return row ? toRecord(row) : null;
  }

  /** Clients audit L3: whether the dev seed created this account (its staff.create audit row). */
  async createdByDevSeed(db: Db, id: string): Promise<boolean> {
    const [row] = await db<{ yes: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM audit_logs
        WHERE action = 'staff.create' AND entity_kind = 'staff_user' AND entity_id = ${id}
          AND after_state->>'via' = 'dev-seed'
      ) AS yes`;
    return row?.yes ?? false;
  }

  async findById(db: Db, id: string): Promise<StaffRecord | null> {
    const [row] = await db<Row[]>`SELECT ${db.unsafe(COLUMNS)} FROM staff_users WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  async lock(tx: Tx, id: string): Promise<StaffRecord | null> {
    const [row] = await tx<Row[]>`
      SELECT ${tx.unsafe(COLUMNS)} FROM staff_users WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  /** Ordered by email (case-insensitive) then id; keyset after `after`. */
  async page(
    db: Db,
    after: { readonly email: string; readonly id: string } | undefined,
    limit: number,
  ): Promise<StaffRecord[]> {
    const rows = await db<Row[]>`
      SELECT ${db.unsafe(COLUMNS)} FROM staff_users
      WHERE ${after ? db`(lower(email), id) > (lower(${after.email}), ${after.id}::uuid)` : db`TRUE`}
      ORDER BY lower(email), id
      LIMIT ${limit}`;
    return rows.map(toRecord);
  }

  async grantsFor(db: Db, staffIds: readonly string[]): Promise<Map<string, StaffGrantRecord[]>> {
    if (staffIds.length === 0) return new Map();
    const rows = await db<
      { id: string; staff_id: string; role: StaffRole; city_id: string | null }[]
    >`
      SELECT id, staff_id, role, city_id FROM staff_role_grants
      WHERE staff_id IN ${db([...new Set(staffIds)])}
      ORDER BY created_at, id`;
    const out = new Map<string, StaffGrantRecord[]>();
    for (const r of rows) {
      const grant: StaffGrantRecord = { id: r.id, role: r.role, cityId: r.city_id };
      out.set(r.staff_id, [...(out.get(r.staff_id) ?? []), grant]);
    }
    return out;
  }

  /** null when the email is taken (case-insensitive unique index). */
  async insert(
    tx: Tx,
    s: {
      readonly email: string;
      readonly fullName: string;
      readonly passwordHash: string;
      readonly password: PasswordKind;
    },
  ): Promise<StaffRecord | null> {
    const temporaryUntil = 'temporaryUntil' in s.password ? s.password.temporaryUntil : null;
    const chosenAt = 'chosenAt' in s.password ? s.password.chosenAt : null;
    try {
      const [row] = await tx<Row[]>`
        INSERT INTO staff_users (email, full_name, password_hash, must_change_password,
                                 temp_password_expires_at, password_changed_at)
        VALUES (${s.email}, ${s.fullName}, ${s.passwordHash}, ${temporaryUntil !== null},
                ${temporaryUntil}, ${chosenAt})
        RETURNING ${tx.unsafe(COLUMNS)}`;
      return row ? toRecord(row) : null;
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  /** 'DUPLICATE' for an identical grant; 'NO_CITY' for an unknown city. Savepoint-safe. */
  async insertGrant(
    tx: Tx,
    g: {
      readonly staffId: string;
      readonly role: StaffRole;
      readonly cityId: string | null;
      readonly grantedBy: string | null;
    },
  ): Promise<StaffGrantRecord | 'DUPLICATE' | 'NO_CITY'> {
    try {
      const [row] = await tx.savepoint(
        (sp) => sp<{ id: string }[]>`
        INSERT INTO staff_role_grants (staff_id, role, city_id, granted_by)
        VALUES (${g.staffId}, ${g.role}, ${g.cityId}, ${g.grantedBy})
        RETURNING id`,
      );
      if (!row) throw new Error('staff_role_grants.insert: no row returned');
      return { id: row.id, role: g.role, cityId: g.cityId };
    } catch (error) {
      if (sqlState(error) === UNIQUE_VIOLATION) return 'DUPLICATE';
      if (sqlState(error) === FOREIGN_KEY_VIOLATION) return 'NO_CITY';
      throw error;
    }
  }

  async findGrant(db: Db, staffId: string, grantId: string): Promise<StaffGrantRecord | null> {
    const [row] = await db<{ id: string; role: StaffRole; city_id: string | null }[]>`
      SELECT id, role, city_id FROM staff_role_grants WHERE id = ${grantId} AND staff_id = ${staffId}`;
    return row ? { id: row.id, role: row.role, cityId: row.city_id } : null;
  }

  async deleteGrant(tx: Tx, grantId: string): Promise<void> {
    await tx`DELETE FROM staff_role_grants WHERE id = ${grantId}`;
  }

  /** Only when none is enrolled yet (a concurrent enrolment loses). */
  async setTotpSecret(tx: Tx, id: string, sealed: string): Promise<boolean> {
    const rows = await tx`
      UPDATE staff_users SET totp_secret = ${sealed} WHERE id = ${id} AND totp_secret IS NULL
      RETURNING id`;
    return rows.length === 1;
  }

  async clearTotp(tx: Tx, id: string): Promise<void> {
    await tx`UPDATE staff_users SET totp_secret = NULL WHERE id = ${id}`;
  }

  /**
   * Replaces the password (ADR-0026 D7). A temporary one must be changed before `temporaryUntil`;
   * a chosen one clears both markers and records when it was chosen.
   */
  async setPassword(tx: Tx, id: string, passwordHash: string, kind: PasswordKind): Promise<void> {
    if ('temporaryUntil' in kind) {
      await tx`
        UPDATE staff_users
        SET password_hash = ${passwordHash}, must_change_password = true,
            temp_password_expires_at = ${kind.temporaryUntil}
        WHERE id = ${id}`;
      return;
    }
    await tx`
      UPDATE staff_users
      SET password_hash = ${passwordHash}, must_change_password = false,
          temp_password_expires_at = NULL, password_changed_at = ${kind.chosenAt}
      WHERE id = ${id}`;
  }

  /**
   * Ends every session of this person from `at` (whole seconds, as access tokens' `iat`): the
   * guard refuses tokens issued before it. Pair it with revoking the refresh tokens.
   */
  async endSessions(tx: Tx, id: string, at: Date): Promise<void> {
    await tx`
      UPDATE staff_users SET sessions_valid_after = date_trunc('second', ${at}::timestamptz)
      WHERE id = ${id}`;
  }

  async markLogin(tx: Tx, id: string, at: Date): Promise<void> {
    await tx`UPDATE staff_users SET last_login_at = ${at} WHERE id = ${id}`;
  }

  /**
   * Active SUPER_ADMINs other than `exceptId`, under a transaction lock shared by every change
   * that could remove one — two admins removing each other cannot leave none.
   */
  async otherActiveSuperAdmins(tx: Tx, exceptId: string): Promise<number> {
    await tx`SELECT pg_advisory_xact_lock(hashtext('staff:super-admins'))`;
    const [row] = await tx<{ n: number }[]>`
      SELECT count(DISTINCT u.id)::int AS n
      FROM staff_users u JOIN staff_role_grants g ON g.staff_id = u.id
      WHERE g.role = 'SUPER_ADMIN' AND u.is_active AND u.id <> ${exceptId}`;
    return row?.n ?? 0;
  }

  async deactivate(tx: Tx, id: string): Promise<void> {
    await tx`UPDATE staff_users SET is_active = false WHERE id = ${id}`;
  }
}
