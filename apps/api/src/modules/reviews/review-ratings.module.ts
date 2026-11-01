import { Module } from '@nestjs/common';
import { ReviewRatings } from './review-ratings.reader';

/**
 * The rating reader on its own, with no imports: the photographers module (owner of
 * photographer_metrics) imports this to recompute a rating. It exposes nothing that can write
 * reviews, and importing ReviewsModule instead would cycle (reviews → dispatch → photographers).
 */
@Module({ providers: [ReviewRatings], exports: [ReviewRatings] })
export class ReviewRatingsModule {}
