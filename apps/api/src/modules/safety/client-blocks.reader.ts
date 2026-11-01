import { Injectable } from '@nestjs/common';
import type postgres from 'postgres';
import type { IdSubquery } from '../../infra/db/id-subquery';

/**
 * The client → photographer blocks as other modules may use them (ADR-0027 D4): an owner-built
 * subquery, so dispatch drops blocked photographers from a booking's candidates in SQL without
 * ever naming `client_photographer_blocks` itself, and a yes/no for one pair.
 */
@Injectable()
export class ClientBlocksReader {
  /** `SELECT photographer_id` of everyone this client blocked. Build one per query, on its connection. */
  blockedPhotographerIds(db: postgres.ISql, userId: string): IdSubquery {
    return db`SELECT photographer_id FROM client_photographer_blocks WHERE user_id = ${userId}`;
  }

  /** Whether this client blocked this photographer — in the caller's transaction. */
  async isBlocked(db: postgres.ISql, userId: string, photographerId: string): Promise<boolean> {
    const [row] = await db<{ blocked: boolean }[]>`
      SELECT ${photographerId}::uuid IN (${this.blockedPhotographerIds(db, userId)}) AS blocked`;
    return row?.blocked ?? false;
  }
}
