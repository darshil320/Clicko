import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { SafetyReadersModule } from '../safety/safety-readers.module';
import { ClientReviewsController } from './client-reviews.controller';
import { ReviewsRepository } from './repositories/reviews.repository';
import { ReviewAccountErasure } from './review-erasure';
import { BookingReviewsService } from './reviews.service';

/**
 * Reviews (ADR-0027 D4, schema §12 + addendum 0016): owns `reviews`. The client rates a
 * delivered booking; bookings answers whose booking it is and its status, dispatch's
 * AssignmentReads who shot it, the safety module's ReportsReader whether a report on it is open. The rating reaches photographer_metrics through `review.*`
 * outbox events that the photographers module handles itself. The moderation desk (safety
 * module) hides or keeps a review through BookingReviewsService.
 */
@Module({
  imports: [BookingsModule, DispatchModule, SafetyReadersModule],
  controllers: [ClientReviewsController],
  providers: [ReviewsRepository, BookingReviewsService, ReviewAccountErasure],
  exports: [BookingReviewsService, ReviewAccountErasure],
})
export class ReviewsModule {}
