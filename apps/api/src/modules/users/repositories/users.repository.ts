import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

export interface UserRecord {
  readonly id: string;
  /** null once the account is deleted (addendum 0020), never otherwise. */
  readonly phone: string | null;
  readonly fullName: string | null;
  readonly isBlocked: boolean;
  /** Set once, when the client deleted the account (ADR-0030). */
  readonly deletedAt: Date | null;
}

/** A live account found or created by its phone: the phone is always there. */
export type PhoneUserRecord = UserRecord & { readonly phone: string };

interface UserRow {
  id: string;
  phone_e164: string | null;
  full_name: string | null;
  is_blocked: boolean;
  deleted_at: Date | null;
}

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  phone: r.phone_e164,
  fullName: r.full_name,
  isBlocked: r.is_blocked,
  deletedAt: r.deleted_at,
});

const withPhone = (r: UserRow & { phone_e164: string }): PhoneUserRecord => ({
  ...toRecord(r),
  phone: r.phone_e164,
});

@Injectable()
export class UsersRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  /**
   * Insert-or-fetch without touching an existing row (so updated_at is not bumped on every login).
   * A deleted account has no phone, so the same number later creates a fresh account.
   */
  async findOrCreateByPhone(phone: string): Promise<{ user: PhoneUserRecord; isNew: boolean }> {
    const [row] = await this.sql<(UserRow & { phone_e164: string; is_new: boolean })[]>`
      WITH ins AS (
        INSERT INTO users (phone_e164) VALUES (${phone})
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING id, phone_e164, full_name, is_blocked, deleted_at
      )
      SELECT id, phone_e164, full_name, is_blocked, deleted_at, true AS is_new FROM ins
      UNION ALL
      SELECT id, phone_e164, full_name, is_blocked, deleted_at, false AS is_new FROM users
      WHERE phone_e164 = ${phone} AND NOT EXISTS (SELECT 1 FROM ins)`;
    if (row) return { user: withPhone(row), isNew: row.is_new };
    // A concurrent first login inserted the row after this statement's snapshot; read it now.
    const [existing] = await this.sql<(UserRow & { phone_e164: string })[]>`
      SELECT id, phone_e164, full_name, is_blocked, deleted_at FROM users
      WHERE phone_e164 = ${phone}`;
    if (!existing) throw new Error('findOrCreateByPhone: no row after conflict');
    return { user: withPhone(existing), isNew: false };
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.sql<UserRow[]>`
      SELECT id, phone_e164, full_name, is_blocked, deleted_at FROM users WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }

  /** SELECT … FOR UPDATE: holds the account for the rest of the caller's transaction. */
  async lock(tx: postgres.TransactionSql, id: string): Promise<UserRecord | null> {
    const [row] = await tx<UserRow[]>`
      SELECT id, phone_e164, full_name, is_blocked, deleted_at FROM users
      WHERE id = ${id} FOR UPDATE`;
    return row ? toRecord(row) : null;
  }

  /**
   * ADR-0030: every personal field cleared, deleted_at set (addendum 0020's CHECKs require
   * exactly this; its trigger refuses any later change). Returns false if already deleted.
   */
  async anonymise(tx: postgres.TransactionSql, id: string, at: Date): Promise<boolean> {
    const rows = await tx`
      UPDATE users
      SET phone_e164 = NULL, full_name = NULL, email = NULL, default_city_id = NULL,
          marketing_opt_in = false, promo_use_consent = false, promo_consent_at = NULL,
          blocked_reason = NULL, deleted_at = ${at}
      WHERE id = ${id} AND deleted_at IS NULL`;
    return rows.count === 1;
  }
}
