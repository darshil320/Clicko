import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

export interface UserRecord {
  readonly id: string;
  readonly phone: string;
  readonly fullName: string | null;
  readonly isBlocked: boolean;
}

interface UserRow {
  id: string;
  phone_e164: string;
  full_name: string | null;
  is_blocked: boolean;
}

const toRecord = (r: UserRow): UserRecord => ({
  id: r.id,
  phone: r.phone_e164,
  fullName: r.full_name,
  isBlocked: r.is_blocked,
});

@Injectable()
export class UsersRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  /** Insert-or-fetch without touching an existing row (so updated_at is not bumped on every login). */
  async findOrCreateByPhone(phone: string): Promise<{ user: UserRecord; isNew: boolean }> {
    const [row] = await this.sql<(UserRow & { is_new: boolean })[]>`
      WITH ins AS (
        INSERT INTO users (phone_e164) VALUES (${phone})
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING id, phone_e164, full_name, is_blocked
      )
      SELECT id, phone_e164, full_name, is_blocked, true AS is_new FROM ins
      UNION ALL
      SELECT id, phone_e164, full_name, is_blocked, false AS is_new FROM users
      WHERE phone_e164 = ${phone} AND NOT EXISTS (SELECT 1 FROM ins)`;
    if (row) return { user: toRecord(row), isNew: row.is_new };
    // A concurrent first login inserted the row after this statement's snapshot; read it now.
    const [existing] = await this.sql<UserRow[]>`
      SELECT id, phone_e164, full_name, is_blocked FROM users WHERE phone_e164 = ${phone}`;
    if (!existing) throw new Error('findOrCreateByPhone: no row after conflict');
    return { user: toRecord(existing), isNew: false };
  }

  async findById(id: string): Promise<UserRecord | null> {
    const [row] = await this.sql<UserRow[]>`
      SELECT id, phone_e164, full_name, is_blocked FROM users WHERE id = ${id}`;
    return row ? toRecord(row) : null;
  }
}
