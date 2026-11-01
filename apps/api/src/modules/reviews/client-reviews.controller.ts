import { ReviewBody, Uuid } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CLOCK, type Clock } from '../../common/clock';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { toClientReview } from './review-rules';
import { BookingReviewsService } from './reviews.service';

/** Per IP, on top of the global backstop: rating is a few taps, never a stream. */
const REVIEW_WRITES_PER_MINUTE = 20;

/**
 * The client's rating of their delivered booking (ADR-0027 D4). Owner only: someone else's
 * booking answers 404, exactly like a missing one.
 */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientReviewsController {
  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(BookingReviewsService) private readonly reviews: BookingReviewsService,
  ) {}

  @Get(':id/review')
  async mine(@CurrentSubject() s: Subject, @Param('id', new ZodValidationPipe(Uuid)) id: string) {
    const review = await this.reviews.mine(s.id, id);
    return ok(review ? toClientReview(review, this.clock()) : null);
  }

  /** Writes the review, or edits it within 7 days of writing it (409 after). */
  @Post(':id/review')
  @HttpCode(200)
  @Throttle({ default: { limit: REVIEW_WRITES_PER_MINUTE, ttl: 60_000 } })
  async save(
    @CurrentSubject() s: Subject,
    @Param('id', new ZodValidationPipe(Uuid)) id: string,
    @Body(new ZodValidationPipe(ReviewBody)) body: ReviewBody,
  ) {
    const now = this.clock();
    return ok(toClientReview(await this.reviews.save(s.id, id, body, now), now));
  }
}
