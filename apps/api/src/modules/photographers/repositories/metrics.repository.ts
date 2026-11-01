import { Injectable } from '@nestjs/common';
import type { Db } from '../photographers.types';

/**
 * Writes to photographer_metrics (schema §6). The rating columns follow every review change
 * (ADR-0027 D4); the other aggregates stay with the nightly job, so a first row carries the
 * rating only and leaves them at their defaults (dispatch ranks a missing metric neutrally).
 * computed_at moves with every write.
 */
@Injectable()
export class MetricsRepository {
  async upsertRating(
    db: Db,
    photographerId: string,
    rating: { readonly avgBps: number | null; readonly count: number },
    at: Date,
  ): Promise<void> {
    await db`
      INSERT INTO photographer_metrics (photographer_id, rating_avg_bps, rating_count, computed_at)
      VALUES (${photographerId}, ${rating.avgBps}, ${rating.count}, ${at})
      ON CONFLICT (photographer_id) DO UPDATE
        SET rating_avg_bps = EXCLUDED.rating_avg_bps, rating_count = EXCLUDED.rating_count,
            computed_at = EXCLUDED.computed_at`;
  }
}
