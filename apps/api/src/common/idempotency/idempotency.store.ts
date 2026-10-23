import { Inject, Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import { SQL } from '../../infra/db/db.module';

export const IDEMPOTENCY_POLICY = {
  /** A key, and the response stored against it, lives this long (G-34). */
  ttlMs: 24 * 60 * 60 * 1000,
  /** An in-flight claim older than this is treated as abandoned by a crashed request. */
  staleLockMs: 2 * 60 * 1000,
} as const;

export interface ClaimRequest {
  /** `<subject id>:<Idempotency-Key header>` */
  readonly key: string;
  /** `<METHOD> <route pattern>` */
  readonly scope: string;
  readonly requestHash: string;
  readonly now: Date;
}

export type ClaimResult =
  | { readonly kind: 'CLAIMED' }
  | { readonly kind: 'REPLAY'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'MISMATCH' }
  | { readonly kind: 'IN_FLIGHT' };

interface KeyRow {
  scope: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  completed_at: Date | null;
}

function classify(row: KeyRow, scope: string, requestHash: string): ClaimResult {
  if (row.scope !== scope || row.request_hash !== requestHash) return { kind: 'MISMATCH' };
  if (row.completed_at !== null && row.response_status !== null) {
    return { kind: 'REPLAY', status: row.response_status, body: row.response_body };
  }
  return { kind: 'IN_FLIGHT' };
}

/** The idempotency_keys table (schema §13). Claims are atomic: INSERT … ON CONFLICT DO NOTHING. */
@Injectable()
export class IdempotencyStore {
  constructor(@Inject(SQL) private readonly sql: postgres.Sql) {}

  async claim(c: ClaimRequest): Promise<ClaimResult> {
    const expiresAt = new Date(c.now.getTime() + IDEMPOTENCY_POLICY.ttlMs);
    const inserted = await this.sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, locked_at, expires_at, created_at)
      VALUES (${c.key}, ${c.scope}, ${c.requestHash}, ${c.now}, ${expiresAt}, ${c.now})
      ON CONFLICT (key) DO NOTHING RETURNING key`;
    if (inserted.length > 0) return { kind: 'CLAIMED' };
    if (await this.reclaim(c, expiresAt)) return { kind: 'CLAIMED' };

    const [row] = await this.sql<KeyRow[]>`
      SELECT scope, request_hash, response_status, response_body, completed_at
      FROM idempotency_keys WHERE key = ${c.key}`;
    // Released between our INSERT and SELECT: the other request failed; ask the client to retry.
    return row ? classify(row, c.scope, c.requestHash) : { kind: 'IN_FLIGHT' };
  }

  async complete(key: string, status: number, body: unknown, now: Date): Promise<void> {
    await this.sql`
      UPDATE idempotency_keys
         SET response_status = ${status}, response_body = ${this.sql.json(body as postgres.JSONValue)},
             completed_at = ${now}
       WHERE key = ${key}`;
  }

  /** Frees an in-flight claim after a failed request. A completed key is never released. */
  async release(key: string): Promise<void> {
    await this.sql`DELETE FROM idempotency_keys WHERE key = ${key} AND completed_at IS NULL`;
  }

  /** Takes over an expired key, or an abandoned claim for the very same request. */
  private async reclaim(c: ClaimRequest, expiresAt: Date): Promise<boolean> {
    const staleBefore = new Date(c.now.getTime() - IDEMPOTENCY_POLICY.staleLockMs);
    const updated = await this.sql`
      UPDATE idempotency_keys
         SET scope = ${c.scope}, request_hash = ${c.requestHash}, locked_at = ${c.now},
             completed_at = NULL, response_status = NULL, response_body = NULL,
             expires_at = ${expiresAt}, created_at = ${c.now}
       WHERE key = ${c.key}
         AND (expires_at <= ${c.now}
              OR (completed_at IS NULL AND locked_at <= ${staleBefore}
                  AND scope = ${c.scope} AND request_hash = ${c.requestHash}))
      RETURNING key`;
    return updated.length > 0;
  }
}
