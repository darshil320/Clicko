import { CancelBookingBody, Uuid } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { CancellationsService } from './cancellations.service';

const BookingId = new ZodValidationPipe(Uuid);
/** No body at all is fine before payment (the app's original cancel call sends none). */
const CancelBody = new ZodValidationPipe(CancelBookingBody.optional());

/**
 * The client cancels their own booking (DOMAIN §2, T&C §3). Quote first, then an idempotent
 * cancel that re-checks the band under the booking lock. Someone else's booking answers 404,
 * exactly like a missing one.
 */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class CancellationsController {
  constructor(@Inject(CancellationsService) private readonly cancellations: CancellationsService) {}

  @Get(':id/cancellation')
  async quote(@CurrentSubject() s: Subject, @Param('id', BookingId) id: string) {
    return ok(await this.cancellations.quote(s.id, id));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  async cancel(
    @CurrentSubject() s: Subject,
    @Param('id', BookingId) id: string,
    @Body(CancelBody) body: CancelBookingBody | undefined,
  ) {
    return ok(await this.cancellations.cancel(s.id, id, body ?? {}));
  }
}
