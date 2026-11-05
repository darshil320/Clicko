import { Injectable } from '@nestjs/common';
import type { Tx } from './safety.types';

export interface SafetyErasure {
  readonly blocks: number;
  /** Reports the client filed whose note was cleared. */
  readonly reportNotes: number;
  /** Reports on the client's reviews whose copy of the words was cleared. */
  readonly reviewCopies: number;
}

/**
 * Account deletion (ADR-0030), in the deletion's transaction. The photographers the client
 * blocked are forgotten. Moderation reports and actions stay as trust-and-safety records, but
 * without the client's words: the note on a report they filed, and the copy of their review's
 * text a report on it kept (its rating stays, as on the review).
 */
@Injectable()
export class ClientSafetyErasure {
  async eraseClient(tx: Tx, userId: string, reviewIds: readonly string[]): Promise<SafetyErasure> {
    const blocks = await tx`DELETE FROM client_photographer_blocks WHERE user_id = ${userId}`;
    const notes = await tx`
      UPDATE moderation_reports SET note = NULL
       WHERE reporter_kind = 'USER' AND reporter_id = ${userId} AND note IS NOT NULL`;
    const copies =
      reviewIds.length === 0
        ? { count: 0 }
        : await tx`
            UPDATE moderation_reports SET reported_comment = NULL
             WHERE target_kind = 'REVIEW' AND target_id = ANY(${tx.array([...reviewIds])}::uuid[])
               AND reported_comment IS NOT NULL`;
    return { blocks: blocks.count, reportNotes: notes.count, reviewCopies: copies.count };
  }
}
