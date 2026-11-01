import { Injectable } from '@nestjs/common';
import type { BlockRecord, Db, Tx } from '../safety.types';

interface Row {
  user_id: string;
  photographer_id: string;
  created_at: Date;
}

const toRecord = (r: Row): BlockRecord => ({
  userId: r.user_id,
  photographerId: r.photographer_id,
  createdAt: r.created_at,
});

/**
 * All SQL on `client_photographer_blocks` (addendum 0016) except dispatch's filter, which is
 * ClientBlocksReader's subquery on the same table.
 */
@Injectable()
export class BlocksRepository {
  async list(db: Db, userId: string): Promise<BlockRecord[]> {
    const rows = await db<Row[]>`
      SELECT user_id, photographer_id, created_at FROM client_photographer_blocks
      WHERE user_id = ${userId} ORDER BY created_at DESC, photographer_id`;
    return rows.map(toRecord);
  }

  async find(db: Db, userId: string, photographerId: string): Promise<BlockRecord | null> {
    const [row] = await db<Row[]>`
      SELECT user_id, photographer_id, created_at FROM client_photographer_blocks
      WHERE user_id = ${userId} AND photographer_id = ${photographerId}`;
    return row ? toRecord(row) : null;
  }

  /** null when the pair is already blocked. */
  async insert(
    tx: Tx,
    userId: string,
    photographerId: string,
    at: Date,
  ): Promise<BlockRecord | null> {
    const [row] = await tx<Row[]>`
      INSERT INTO client_photographer_blocks (user_id, photographer_id, created_at)
      VALUES (${userId}, ${photographerId}, ${at})
      ON CONFLICT (user_id, photographer_id) DO NOTHING
      RETURNING user_id, photographer_id, created_at`;
    return row ? toRecord(row) : null;
  }

  /** false when there was no block. */
  async remove(tx: Tx, userId: string, photographerId: string): Promise<boolean> {
    const rows = await tx`
      DELETE FROM client_photographer_blocks
      WHERE user_id = ${userId} AND photographer_id = ${photographerId}
      RETURNING id`;
    return rows.length > 0;
  }
}
