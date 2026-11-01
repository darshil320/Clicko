import { Injectable } from '@nestjs/common';
import type { Db, RatingSummary } from './reviews.types';

/**
 * A photographer's published rating, for the module that owns photographer_metrics (ADR-0027
 * D4). Published CLIENT_TO_PRO reviews only: a review staff hid stops counting. The average is
 * stored ×1000 (4.87 → 4870), as photographer_metrics.rating_avg_bps expects.
 */
@Injectable()
export class ReviewRatings {
  async forPhotographer(db: Db, photographerId: string): Promise<RatingSummary> {
    const [row] = await db<{ n: number; avg_bps: number | null }[]>`
      SELECT count(*)::int AS n, round(avg(rating) * 1000)::int AS avg_bps
      FROM reviews
      WHERE photographer_id = ${photographerId} AND direction = 'CLIENT_TO_PRO' AND is_published`;
    const count = row?.n ?? 0;
    return { avgBps: count === 0 ? null : (row?.avg_bps ?? null), count };
  }
}
