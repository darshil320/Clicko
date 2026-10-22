import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

export interface OtpChallengeRow {
  readonly id: string;
  readonly phone: string;
  readonly codeHash: string;
  readonly purpose: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly consumedAt: Date | null;
  readonly expiresAt: Date;
  readonly ip: string | null;
  readonly createdAt: Date;
}

export interface OtpRepository {
  countForPhoneSince(phone: string, since: Date): Promise<number>;
  countForIpSince(ip: string, since: Date): Promise<number>;
  latestCreatedAt(phone: string): Promise<Date | null>;
  insert(row: OtpChallengeRow): Promise<void>;
  /** Retires every unused challenge for this phone + purpose (only the newest code works). */
  supersedeActive(phone: string, purpose: string, now: Date): Promise<void>;
  /**
   * Runs `fn` in one transaction holding advisory locks on the phone and the IP,
   * so concurrent requests cannot all pass the rate-limit checks before inserting.
   */
  withLocks<T>(
    phone: string,
    ip: string | null,
    fn: (repo: OtpRepository) => Promise<T>,
  ): Promise<T>;
  /** Atomically counts an attempt on a still-usable challenge; null when none is usable. */
  recordAttempt(
    id: string,
    phone: string,
    purpose: string,
    now: Date,
  ): Promise<{ codeHash: string } | null>;
  /** Marks consumed; false if another request consumed it first. */
  consume(id: string, now: Date): Promise<boolean>;
}

export const OTP_REPOSITORY = Symbol('OTP_REPOSITORY');

@Injectable()
export class PgOtpRepository implements OtpRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql | postgres.TransactionSql) {}

  async withLocks<T>(
    phone: string,
    ip: string | null,
    fn: (repo: OtpRepository) => Promise<T>,
  ): Promise<T> {
    const root = this.sql as postgres.Sql;
    return root.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext('otp:phone:' || ${phone}))`;
      if (ip) {
        await tx`SELECT pg_advisory_xact_lock(hashtext('otp:ip:' || host(set_masklen(${ip}::inet,
                   CASE WHEN family(${ip}::inet) = 6 THEN 64 ELSE 32 END))))`;
      }
      return fn(new PgOtpRepository(tx));
    }) as Promise<T>;
  }

  async supersedeActive(phone: string, purpose: string, now: Date): Promise<void> {
    await this.sql`
      UPDATE otp_challenges SET consumed_at = ${now}
      WHERE phone_e164 = ${phone} AND purpose = ${purpose} AND consumed_at IS NULL`;
  }

  async countForPhoneSince(phone: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM otp_challenges WHERE phone_e164 = ${phone} AND created_at >= ${since}`;
    return row?.n ?? 0;
  }

  async countForIpSince(ip: string, since: Date): Promise<number> {
    const [row] = await this.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM otp_challenges
      WHERE created_at >= ${since}
        -- IPv6 clients are counted per /64: one subscriber usually owns the whole prefix.
        AND created_ip <<= set_masklen(${ip}::inet, CASE WHEN family(${ip}::inet) = 6 THEN 64 ELSE 32 END)`;
    return row?.n ?? 0;
  }

  async latestCreatedAt(phone: string): Promise<Date | null> {
    const [row] = await this.sql<{ at: Date | null }[]>`
      SELECT max(created_at) AS at FROM otp_challenges WHERE phone_e164 = ${phone}`;
    return row?.at ?? null;
  }

  async insert(row: OtpChallengeRow): Promise<void> {
    await this.sql`
      INSERT INTO otp_challenges
        (id, phone_e164, code_hash, purpose, attempts, max_attempts, expires_at, created_ip, created_at)
      VALUES (${row.id}, ${row.phone}, ${row.codeHash}, ${row.purpose}, ${row.attempts},
              ${row.maxAttempts}, ${row.expiresAt}, ${row.ip}::inet, ${row.createdAt})`;
  }

  async recordAttempt(
    id: string,
    phone: string,
    purpose: string,
    now: Date,
  ): Promise<{ codeHash: string } | null> {
    const [row] = await this.sql<{ code_hash: string }[]>`
      UPDATE otp_challenges SET attempts = attempts + 1
      WHERE id = ${id} AND phone_e164 = ${phone} AND purpose = ${purpose} AND consumed_at IS NULL
        AND expires_at > ${now} AND attempts < max_attempts
      RETURNING code_hash`;
    return row ? { codeHash: row.code_hash } : null;
  }

  async consume(id: string, now: Date): Promise<boolean> {
    const rows = await this.sql`
      UPDATE otp_challenges SET consumed_at = ${now} WHERE id = ${id} AND consumed_at IS NULL RETURNING id`;
    return rows.length === 1;
  }
}
