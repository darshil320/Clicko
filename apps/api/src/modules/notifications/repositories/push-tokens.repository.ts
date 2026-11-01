import type { PushPlatform } from '@clickco/contracts';
import { Injectable } from '@nestjs/common';
import { type AccountRef, type Db, ownerColumn, type Tx } from '../notifications.types';

export interface RegisterOutcome {
  /** REFUSED: another account held it live and recently; it was revoked, not moved. */
  readonly outcome: 'REGISTERED' | 'MOVED' | 'REFUSED';
  readonly lastSeenAt: Date;
}

interface HeldRow {
  id: string;
  user_id: string | null;
  photographer_id: string | null;
  last_seen_at: Date;
  revoked_at: Date | null;
}

/**
 * device_push_tokens. One row per Expo token (unique): an install belongs to one account at a
 * time. Revoked rows are kept (bounded by `cap`) until registered again.
 */
@Injectable()
export class PushTokensRepository {
  /**
   * Register or refresh. A token another account holds moves here only if that hold is revoked or
   * stale (not seen for `moveAfterMs`); a live, recently seen one held elsewhere is revoked instead
   * (REFUSED) — nobody can take over another account's device by replaying its token. The app
   * registers again on its next start, and then the token is free to move.
   */
  async register(
    tx: Tx,
    owner: AccountRef,
    token: string,
    platform: PushPlatform,
    now: Date,
    moveAfterMs: number,
  ): Promise<RegisterOutcome> {
    const userId = owner.kind === 'USER' ? owner.id : null;
    const photographerId = owner.kind === 'PHOTOGRAPHER' ? owner.id : null;
    const [created] = await tx<{ last_seen_at: Date }[]>`
      INSERT INTO device_push_tokens
        (user_id, photographer_id, expo_token, platform, created_at, last_seen_at)
      VALUES (${userId}, ${photographerId}, ${token}, ${platform}, ${now}, ${now})
      ON CONFLICT (expo_token) DO NOTHING
      RETURNING last_seen_at`;
    if (created) return { outcome: 'REGISTERED', lastSeenAt: created.last_seen_at };
    const [held] = await tx<HeldRow[]>`
      SELECT id, user_id, photographer_id, last_seen_at, revoked_at
      FROM device_push_tokens WHERE expo_token = ${token} FOR UPDATE`;
    if (!held) throw new Error('device_push_tokens: token vanished during registration');
    const mine = (owner.kind === 'USER' ? held.user_id : held.photographer_id) === owner.id;
    const live = held.revoked_at === null;
    const recent = now.getTime() - held.last_seen_at.getTime() < moveAfterMs;
    if (!mine && live && recent) {
      await tx`UPDATE device_push_tokens SET revoked_at = ${now} WHERE id = ${held.id}`;
      return { outcome: 'REFUSED', lastSeenAt: held.last_seen_at };
    }
    const [row] = await tx<{ last_seen_at: Date }[]>`
      UPDATE device_push_tokens
         SET user_id = ${userId}, photographer_id = ${photographerId}, platform = ${platform},
             last_seen_at = ${now}, revoked_at = NULL
       WHERE id = ${held.id}
      RETURNING last_seen_at`;
    if (!row) throw new Error('device_push_tokens: update matched no row');
    return { outcome: mine ? 'REGISTERED' : 'MOVED', lastSeenAt: row.last_seen_at };
  }

  /**
   * At most `max` live tokens per account (the least recently seen beyond it are revoked), and at
   * most `max` revoked ones kept (the rest deleted): the table cannot grow without bound.
   */
  async cap(tx: Tx, owner: AccountRef, max: number, now: Date): Promise<void> {
    const col = ownerColumn(owner);
    await tx`
      UPDATE device_push_tokens SET revoked_at = ${now}
      WHERE id IN (
        SELECT id FROM device_push_tokens
        WHERE ${tx(col)} = ${owner.id} AND revoked_at IS NULL
        ORDER BY last_seen_at DESC, id DESC
        OFFSET ${max}
      )`;
    await tx`
      DELETE FROM device_push_tokens
      WHERE id IN (
        SELECT id FROM device_push_tokens
        WHERE ${tx(col)} = ${owner.id} AND revoked_at IS NOT NULL
        ORDER BY revoked_at DESC, id DESC
        OFFSET ${max}
      )`;
  }

  /** Only the account's own token; true when it was live. */
  async revokeOwn(db: Db, owner: AccountRef, token: string, now: Date): Promise<boolean> {
    const col = ownerColumn(owner);
    const revoked = await db`
      UPDATE device_push_tokens SET revoked_at = ${now}
      WHERE expo_token = ${token} AND ${db(col)} = ${owner.id} AND revoked_at IS NULL`;
    return revoked.count > 0;
  }

  async live(db: Db, owner: AccountRef): Promise<string[]> {
    const col = ownerColumn(owner);
    const rows = await db<{ expo_token: string }[]>`
      SELECT expo_token FROM device_push_tokens
      WHERE ${db(col)} = ${owner.id} AND revoked_at IS NULL
      ORDER BY last_seen_at DESC, id DESC`;
    return rows.map((r) => r.expo_token);
  }

  /** The push service said these are gone (uninstalled): revoke whoever holds them. */
  async revokeTokens(db: Db, tokens: readonly string[], now: Date): Promise<number> {
    if (tokens.length === 0) return 0;
    const revoked = await db`
      UPDATE device_push_tokens SET revoked_at = ${now}
      WHERE expo_token IN ${db([...new Set(tokens)])} AND revoked_at IS NULL`;
    return revoked.count;
  }
}
