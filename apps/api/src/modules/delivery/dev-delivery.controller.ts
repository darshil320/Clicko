import { QaDecisionBody, Uuid } from '@clickco/contracts';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ok } from '../../common/envelope';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ENV, type Env } from '../../config/env';
import { SYSTEM_ACTOR } from '../bookings/bookings.types';
import { QaService } from './qa.service';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };

/** The QA desk's stand-in for the console (S9 builds the staff desk). Development only. */
@Controller('dev/deliveries')
export class DevDeliveryController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(QaService) private readonly qa: QaService,
  ) {}

  @Get(':bookingId')
  async view(@Param('bookingId', new ZodValidationPipe(Uuid)) bookingId: string) {
    this.devOnly();
    return ok(await this.qa.view(bookingId));
  }

  @Post(':bookingId/qa')
  @HttpCode(200)
  async decide(
    @Param('bookingId', new ZodValidationPipe(Uuid)) bookingId: string,
    @Body(new ZodValidationPipe(QaDecisionBody)) body: QaDecisionBody,
  ) {
    this.devOnly();
    return ok(await this.qa.decide(bookingId, body.result, body.note ?? null, SYSTEM_ACTOR));
  }

  private devOnly(): void {
    if (this.env.NODE_ENV !== 'development') throw new NotFoundException(NOT_FOUND);
  }
}
