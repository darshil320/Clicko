import { AssignmentEventId, Uuid } from '@clickco/contracts';
import { Controller, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { UserGuard } from '../../common/guards/user.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { ExtensionsService } from './extensions.service';
import { requireUser } from './http-errors';

const BookingId = new ZodValidationPipe(Uuid);
const EventId = new ZodValidationPipe(AssignmentEventId);

/**
 * The client answers an extension request (G-16, T&C §6.1: in-app approval before it starts).
 * Owner only — anyone else's booking is 404. Approval raises the balance: @Idempotent.
 */
@Controller('bookings')
// Audit L1: USER sessions of accounts that are not blocked, checked on every request.
@UseGuards(UserGuard)
export class ClientExtensionsController {
  constructor(@Inject(ExtensionsService) private readonly extensions: ExtensionsService) {}

  @Post(':id/extensions/:eventId/approve')
  @HttpCode(200)
  @Idempotent()
  async approve(
    @CurrentSubject() s: Subject,
    @Param('id', BookingId) id: string,
    @Param('eventId', EventId) eventId: string,
  ) {
    return ok(await this.extensions.approve(requireUser(s), id, eventId));
  }

  @Post(':id/extensions/:eventId/decline')
  @HttpCode(200)
  @Idempotent()
  async decline(
    @CurrentSubject() s: Subject,
    @Param('id', BookingId) id: string,
    @Param('eventId', EventId) eventId: string,
  ) {
    return ok(await this.extensions.decline(requireUser(s), id, eventId));
  }
}
