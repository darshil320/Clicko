import { CancelAssignmentBody, Uuid } from '@clickco/contracts';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentSubject } from '../../common/decorators/current-subject.decorator';
import { ok } from '../../common/envelope';
import { ProGuard } from '../../common/guards/pro.guard';
import { Idempotent } from '../../common/idempotency/idempotent.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { Subject } from '../auth/token.service';
import { PRO_IDEMPOTENCY_TTL_MS } from './dispatch.config';
import { photographerId } from './http-errors';
import { OffersService } from './offers.service';
import { RedispatchService } from './redispatch.service';

/** Accepted work. The exact address appears here, never in an offer. */
@Controller('pro/assignments')
@UseGuards(ProGuard)
export class ProAssignmentsController {
  constructor(
    @Inject(OffersService) private readonly offers: OffersService,
    @Inject(RedispatchService) private readonly redispatch: RedispatchService,
  ) {}

  @Get()
  async upcoming(@CurrentSubject() subject: Subject) {
    return ok(await this.offers.upcoming(photographerId(subject)));
  }

  /** The photographer pulls out: the booking goes back to dispatch (ADR-0011). */
  @Post(':assignmentId/cancel')
  @HttpCode(200)
  @Idempotent({ ttlMs: PRO_IDEMPOTENCY_TTL_MS })
  async cancel(
    @CurrentSubject() subject: Subject,
    @Param('assignmentId', new ZodValidationPipe(Uuid)) id: string,
    @Body(new ZodValidationPipe(CancelAssignmentBody)) body: CancelAssignmentBody,
  ) {
    return ok(await this.redispatch.cancelByPhotographer(photographerId(subject), id, body.reason));
  }
}
