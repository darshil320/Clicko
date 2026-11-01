import { Uuid } from '@clickco/contracts';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type postgres from 'postgres';
import { CLOCK, type Clock } from '../../common/clock';
import { SQL } from '../../infra/db/db.module';
import { OutboxSubscribers, type PublishedEvent } from '../../infra/outbox/outbox-subscribers';
import { ReviewRatings } from '../reviews/review-ratings.reader';
import { MetricsRepository } from './repositories/metrics.repository';

/** Every review change that can move a photographer's published rating. */
export const RATING_EVENTS = [
  'review.submitted',
  'review.edited',
  'review.hidden',
  'review.kept',
] as const;

/**
 * photographer_metrics.rating_avg_bps / rating_count follow the reviews (ADR-0027 D4). This
 * module owns the metrics, so it recomputes them itself on each `review.*` event — from the
 * reviews module's reader, never its table. Recomputing from scratch makes a redelivered or
 * out-of-order event harmless; a per-photographer lock makes the last writer read the latest.
 */
@Injectable()
export class RatingSubscribers implements OnModuleInit {
  constructor(
    @Inject(SQL) private readonly sql: postgres.Sql,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OutboxSubscribers) private readonly subscribers: OutboxSubscribers,
    @Inject(ReviewRatings) private readonly ratings: ReviewRatings,
    @Inject(MetricsRepository) private readonly metrics: MetricsRepository,
  ) {}

  onModuleInit(): void {
    for (const eventType of RATING_EVENTS) {
      this.subscribers.subscribe(eventType, 'photographers.rating', (e) => this.onReview(e));
    }
  }

  private async onReview(e: PublishedEvent): Promise<void> {
    if (e.payload.direction !== 'CLIENT_TO_PRO') return;
    const id = Uuid.safeParse(e.payload.photographer_id);
    if (!id.success) throw new Error(`${e.eventType} ${e.eventId}: no photographer_id`);
    await this.refresh(id.data);
  }

  /** The photographer's rating, recomputed from every published review. */
  async refresh(photographerId: string): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`photographer-rating:${photographerId}`}))`;
      const rating = await this.ratings.forPhotographer(tx, photographerId);
      await this.metrics.upsertRating(tx, photographerId, rating, this.clock());
    });
  }
}
