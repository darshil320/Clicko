import { Injectable } from '@nestjs/common';
import type { Tx } from './reviews.types';

export interface ReviewErasure {
  /** The client's own reviews (CLIENT_TO_PRO), kept: reports on them lose their copy too. */
  readonly reviewIds: readonly string[];
  /** CLIENT_TO_PRO reviews whose comment was cleared (the rating stays). */
  readonly commentsCleared: number;
  /** PRO_TO_CLIENT reviews (about the client) removed. */
  readonly aboutClientRemoved: number;
}

/**
 * Account deletion (ADR-0030), in the deletion's transaction. A deleted client's reviews keep
 * their rating and sub-scores (the photographer's published rating does not move) and lose their
 * words; reviews has no author column, and the booking it hangs on now points at an anonymous
 * account. Reviews written about the client are removed.
 */
@Injectable()
export class ReviewAccountErasure {
  async eraseClient(tx: Tx, bookingIds: readonly string[], at: Date): Promise<ReviewErasure> {
    if (bookingIds.length === 0) {
      return { reviewIds: [], commentsCleared: 0, aboutClientRemoved: 0 };
    }
    const ids = tx.array([...bookingIds]);
    const own = await tx<{ id: string }[]>`
      SELECT id FROM reviews
      WHERE direction = 'CLIENT_TO_PRO' AND booking_id = ANY(${ids}::uuid[])`;
    const cleared = await tx`
      UPDATE reviews SET comment = NULL, updated_at = greatest(updated_at, ${at})
      WHERE direction = 'CLIENT_TO_PRO' AND booking_id = ANY(${ids}::uuid[])
        AND comment IS NOT NULL`;
    const removed = await tx`
      DELETE FROM reviews
      WHERE direction = 'PRO_TO_CLIENT' AND booking_id = ANY(${ids}::uuid[])`;
    return {
      reviewIds: own.map((r) => r.id),
      commentsCleared: cleared.count,
      aboutClientRemoved: removed.count,
    };
  }
}
