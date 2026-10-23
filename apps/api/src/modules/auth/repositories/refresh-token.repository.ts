import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../../infra/db/db.module';

export type SubjectKind = 'USER' | 'PHOTOGRAPHER' | 'STAFF';

export interface RefreshTokenRow {
  readonly id: string;
  readonly subjectKind: SubjectKind;
  readonly subjectId: string;
  readonly tokenHash: string;
  readonly deviceId: string | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** A new token row before it is bound to a subject (rotation inherits the old token's subject). */
export type UnboundRefreshToken = Omit<RefreshTokenRow, 'subjectKind' | 'subjectId'>;

export type RotateResult =
  | { readonly outcome: 'ROTATED'; readonly subjectKind: SubjectKind; readonly subjectId: string }
  /** GRACE: rotated moments ago — a duplicate client retry, refused without the mass revoke. */
  | { readonly outcome: 'NOT_FOUND' | 'EXPIRED' | 'REUSED' | 'GRACE' };

export interface RefreshTokenRepository {
  insert(row: RefreshTokenRow): Promise<void>;
  /**
   * Atomically revokes `tokenHash` and inserts `replacement` for the same subject.
   * A token that was already revoked means it was stolen and replayed: every live
   * token for that subject is revoked and REUSED returned — unless it was revoked
   * within `graceMs`, which is a client retry (GRACE). The replacement inherits the
   * old token's subject and device. A token of another subject kind than `expectedKind` is
   * NOT_FOUND and left untouched (a pro token sent to the client route is not consumed).
   */
  rotate(
    tokenHash: string,
    now: Date,
    replacement: UnboundRefreshToken,
    graceMs: number,
    expectedKind: SubjectKind,
  ): Promise<RotateResult>;
  revokeAllForSubject(kind: SubjectKind, id: string, now: Date): Promise<void>;
  revoke(tokenHash: string, now: Date): Promise<void>;
}

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

@Injectable()
export class PgRefreshTokenRepository implements RefreshTokenRepository {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async insert(row: RefreshTokenRow): Promise<void> {
    await this.sql`
      INSERT INTO refresh_tokens (id, subject_kind, subject_id, token_hash, device_id, expires_at, created_at)
      VALUES (${row.id}, ${row.subjectKind}, ${row.subjectId}, ${row.tokenHash}, ${row.deviceId},
              ${row.expiresAt}, ${row.createdAt})`;
  }

  async rotate(
    tokenHash: string,
    now: Date,
    replacement: UnboundRefreshToken,
    graceMs: number,
    expectedKind: SubjectKind,
  ): Promise<RotateResult> {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<
        {
          subject_kind: SubjectKind;
          subject_id: string;
          device_id: string | null;
          revoked_at: Date | null;
          expires_at: Date;
        }[]
      >`
        SELECT subject_kind, subject_id, device_id, revoked_at, expires_at FROM refresh_tokens
        WHERE token_hash = ${tokenHash} FOR UPDATE`;
      if (!row || row.subject_kind !== expectedKind) return { outcome: 'NOT_FOUND' } as const;
      if (row.revoked_at) {
        // Rotated moments ago: a duplicate client retry, not theft — refuse without the mass revoke.
        if (now.getTime() - row.revoked_at.getTime() <= graceMs)
          return { outcome: 'GRACE' } as const;
        await tx`
          UPDATE refresh_tokens SET revoked_at = ${now}
          WHERE subject_kind = ${row.subject_kind} AND subject_id = ${row.subject_id} AND revoked_at IS NULL`;
        return { outcome: 'REUSED' } as const;
      }
      if (row.expires_at <= now) return { outcome: 'EXPIRED' } as const;
      await tx`UPDATE refresh_tokens SET revoked_at = ${now} WHERE token_hash = ${tokenHash}`;
      await tx`
        INSERT INTO refresh_tokens (id, subject_kind, subject_id, token_hash, device_id, expires_at, created_at)
        VALUES (${replacement.id}, ${row.subject_kind}, ${row.subject_id}, ${replacement.tokenHash},
                ${replacement.deviceId ?? row.device_id}, ${replacement.expiresAt}, ${replacement.createdAt})`;
      return {
        outcome: 'ROTATED',
        subjectKind: row.subject_kind,
        subjectId: row.subject_id,
      } as const;
    });
  }

  async revokeAllForSubject(kind: SubjectKind, id: string, now: Date): Promise<void> {
    await this.sql`
      UPDATE refresh_tokens SET revoked_at = ${now}
      WHERE subject_kind = ${kind} AND subject_id = ${id} AND revoked_at IS NULL`;
  }

  async revoke(tokenHash: string, now: Date): Promise<void> {
    await this.sql`
      UPDATE refresh_tokens SET revoked_at = ${now} WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`;
  }
}
