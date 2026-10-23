import { DeclineOfferBody, Uuid } from '@clickco/contracts';
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

const AttemptId = new ZodValidationPipe(Uuid);

/** The Pro app's offer inbox (ADR-0010). Accepting may capture a held payment: @Idempotent. */
@Controller('pro/offers')
@UseGuards(ProGuard)
export class ProOffersController {
  constructor(@Inject(OffersService) private readonly offers: OffersService) {}

  @Get()
  async list(@CurrentSubject() subject: Subject) {
    return ok(await this.offers.list(photographerId(subject)));
  }

  @Post(':attemptId/accept')
  @HttpCode(200)
  @Idempotent({ ttlMs: PRO_IDEMPOTENCY_TTL_MS })
  async accept(@CurrentSubject() subject: Subject, @Param('attemptId', AttemptId) id: string) {
    return ok(await this.offers.accept(photographerId(subject), id));
  }

  @Post(':attemptId/decline')
  @HttpCode(200)
  async decline(
    @CurrentSubject() subject: Subject,
    @Param('attemptId', AttemptId) id: string,
    @Body(new ZodValidationPipe(DeclineOfferBody)) body: DeclineOfferBody,
  ) {
    return ok(await this.offers.decline(photographerId(subject), id, body.reason));
  }
}
